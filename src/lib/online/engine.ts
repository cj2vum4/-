import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { GameError } from "../errors";
import { imageNames } from "./rich";
import { getScript, groupsOf, scriptForCode, type DocDef, type ScriptDef } from "./scripts";
import { getOnlineStore, type OnlineSession } from "./store";
import type {
  Broadcast,
  HostCatalog,
  HostClue,
  OnlineHostSnapshot,
  OnlineLobby,
  OnlinePlayerSnapshot,
  OnlineScriptId,
  PlayerClue,
  PlayerDoc,
} from "./types";

/**
 * 線上主持引擎：瘋兔子、天才在左我在右共用。
 *
 * 核心原則——劇本內容只在伺服器上。主持人拿全部，玩家只拿
 * 「發給全體」＋「發給自己角色」＋「自己輸入代碼解開」的線索，
 * 以及已開放的劇本段落。沒開放的內容不會出現在任何回應裡。
 *
 * 部署假設與九爺相同：單一 Node 程序（Render 一個實例），
 * 所以快取與鎖放記憶體即可。
 */

const MAX_BROADCASTS = 40;
const MAX_BROADCAST_LEN = 300;
/** 超過這麼久沒輪詢就當作離線 */
const ONLINE_WINDOW_MS = 20_000;

const g = globalThis as unknown as {
  __onlineCache?: Map<string, OnlineSession>;
  __onlineLocks?: Map<string, Promise<unknown>>;
  __onlineSeen?: Map<string, number>;
  __onlineSecret?: string;
};
const cache: Map<string, OnlineSession> = (g.__onlineCache ??= new Map());
const locks: Map<string, Promise<unknown>> = (g.__onlineLocks ??= new Map());
const lastSeen: Map<string, number> = (g.__onlineSeen ??= new Map());

/** 同一場次的寫入串成一條鏈，避免兩個主持人同時操作互相覆蓋 */
function withLock<T>(code: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(code) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    code,
    next.catch(() => {}),
  );
  return next;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const now = () => new Date().toISOString();

// ---------------- 場次代碼 ----------------

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeOnlineCode(raw: string): string {
  return decodeURIComponent(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function requireOnlineCode(raw: string): { code: string; script: OnlineScriptId } {
  const code = normalizeOnlineCode(raw);
  const script = scriptForCode(code);
  if (!script || !/^[A-Z]{2}-[A-Z0-9]{4,10}$/.test(code)) {
    throw new GameError("BAD_REQUEST", "場次代碼格式不正確");
  }
  return { code, script };
}

function generateCode(def: ScriptDef): string {
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return def.codePrefix + suffix;
}

// ---------------- 讀寫 ----------------

/** 場次代碼前綴決定劇本，也就決定資料存在哪一份試算表 */
function storeFor(code: string) {
  const script = scriptForCode(code);
  if (!script) throw new GameError("BAD_REQUEST", "場次代碼格式不正確");
  return getOnlineStore(script);
}

async function load(code: string): Promise<OnlineSession> {
  const hit = cache.get(code);
  if (hit) return hit;
  const s = await storeFor(code).get(code);
  if (!s) throw new GameError("SESSION_NOT_FOUND", "找不到這個場次，請確認代碼");
  cache.set(code, s);
  return s;
}

/** 在鎖內修改並寫回。寫入失敗時丟掉快取，下次從儲存層重讀，不讓記憶體與試算表分岔 */
function mutate<T>(code: string, fn: (s: OnlineSession) => T): Promise<T> {
  return withLock(code, async () => {
    const draft = structuredClone(await load(code));
    const result = fn(draft);
    draft.rev += 1;
    draft.updatedAt = now();
    try {
      await storeFor(code).save(draft);
    } catch (err) {
      cache.delete(code);
      throw err;
    }
    cache.set(code, draft);
    return result;
  });
}

// ---------------- 主持人 ----------------

export async function createOnlineSession(
  script: OnlineScriptId,
  pin: string,
): Promise<string> {
  const p = (pin ?? "").trim();
  if (p.length < 4) throw new GameError("BAD_REQUEST", "主持密碼至少要 4 個字");
  const def = getScript(script);
  const store = getOnlineStore(script);

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode(def);
    if (cache.has(code) || (await store.get(code))) continue;
    const t = now();
    const session: OnlineSession = {
      code,
      script,
      status: "active",
      hostPinHash: sha256(p),
      phase: 0,
      released: {},
      unlocks: {},
      broadcasts: [],
      seats: {},
      createdAt: t,
      updatedAt: t,
      rev: 1,
    };
    await withLock(code, async () => {
      await store.save(session);
      cache.set(code, session);
    });
    return code;
  }
  throw new GameError("SESSION_EXISTS", "產生場次代碼失敗，請再試一次");
}

export async function assertHost(code: string, pin: string): Promise<OnlineSession> {
  const s = await load(code);
  if (!pin || !safeEqual(sha256(pin.trim()), s.hostPinHash)) {
    throw new GameError("UNAUTHORIZED", "主持密碼不正確");
  }
  return s;
}

function assertActive(s: OnlineSession) {
  if (s.status === "ended") throw new GameError("SESSION_CLOSED", "場次已結束");
}

export async function hostSnapshot(code: string): Promise<OnlineHostSnapshot> {
  const s = await load(code);
  const t = Date.now();
  return {
    rev: s.rev,
    code: s.code,
    script: s.script,
    status: s.status,
    phase: s.phase,
    released: s.released,
    unlocks: s.unlocks,
    broadcasts: s.broadcasts,
    seats: Object.entries(s.seats).map(([roleId, seat]) => ({
      roleId,
      nickname: seat.nickname,
      joinedAt: seat.joinedAt,
      extra: seat.extra,
      online: t - (lastSeen.get(`${code}:${roleId}`) ?? 0) < ONLINE_WINDOW_MS,
    })),
  };
}

export async function hostCatalog(code: string): Promise<HostCatalog> {
  const s = await load(code);
  const def = getScript(s.script);
  const { clues, note } = await def.loadClues();
  return {
    script: def.id,
    title: def.title,
    roles: def.roles,
    phases: def.phases,
    groups: groupsOf(def, clues),
    unlocks: def.unlocks,
    clues: clues.map((c) => ({
      ...c,
      images: c.images.map((name) => assetUrl(code, "host", name)),
    })),
    templates: def.templates,
    handbook: def.handbook.map((h) => ({ ...h, images: signedImages(code, "host", h.note ?? "") })),
    clueSourceNote: note,
  };
}

async function clueMap(def: ScriptDef): Promise<Map<string, HostClue>> {
  const { clues } = await def.loadClues();
  return new Map(clues.map((c) => [c.id, c]));
}

function systemBroadcast(s: OnlineSession, message: string) {
  pushBroadcast(s, message, "system");
}

function pushBroadcast(s: OnlineSession, message: string, kind: Broadcast["kind"]) {
  s.broadcasts.unshift({ id: randomBytes(6).toString("hex"), message, at: now(), kind });
  s.broadcasts = s.broadcasts.slice(0, MAX_BROADCASTS);
}

export type HostAction =
  | { action: "phase"; phase: number }
  | { action: "release"; clueId: string; to: "default" | "all" | string }
  | { action: "revoke"; clueId: string }
  | { action: "unlock"; key: string; on: boolean }
  | { action: "releaseGroup"; group: string }
  | { action: "broadcast"; message: string }
  | { action: "freeSeat"; roleId: string }
  | { action: "end" };

export async function hostAction(code: string, a: HostAction): Promise<void> {
  const current = await load(code);
  const def = getScript(current.script);
  // 線索清單要在鎖外先載好，鎖內只做記憶體運算
  const clues = a.action === "release" || a.action === "releaseGroup" ? await clueMap(def) : null;

  await mutate(code, (s) => {
    if (a.action !== "end") assertActive(s);
    switch (a.action) {
      case "phase": {
        const target = Math.trunc(Number(a.phase));
        if (!(target >= 0 && target < def.phases.length)) {
          throw new GameError("BAD_REQUEST", "沒有這個階段");
        }
        // 往回退時，把被跳過的階段自動打開的內容再關上
        for (let i = target + 1; i <= s.phase; i++) {
          const key = def.phases[i]?.unlock;
          if (key) delete s.unlocks[key];
        }
        s.phase = target;
        const key = def.phases[target].unlock;
        if (key) s.unlocks[key] = true;
        if (def.announcePhase) {
          systemBroadcast(
            s,
            `⚡ 主持人通知：現在進入【${def.phases[target].name}】` +
              (key ? "，劇本已開放，請翻到對應幕。" : ""),
          );
        }
        return;
      }
      case "release": {
        const clue = clues!.get(a.clueId);
        if (!clue) throw new GameError("BAD_CLUE", "找不到這條線索");
        release(s, def, clue, a.to);
        return;
      }
      case "releaseGroup": {
        for (const clue of clues!.values()) {
          if (clue.group !== a.group || clue.audience === "pick") continue;
          release(s, def, clue, "default");
        }
        // 要在特定步驟開的段落（小劇場）不跟著一起開，只能在流程分頁單獨開放
        for (const u of def.unlocks) if (u.group === a.group && !u.phase) s.unlocks[u.key] = true;
        return;
      }
      case "revoke": {
        delete s.released[a.clueId];
        for (const seat of Object.values(s.seats)) {
          seat.extra = seat.extra.filter((id) => id !== a.clueId);
        }
        return;
      }
      case "unlock": {
        const u = def.unlocks.find((x) => x.key === a.key);
        if (!u) throw new GameError("BAD_REQUEST", "沒有這個解鎖項目");
        if (a.on) {
          // 只在「從關到開」時提醒一次，重複按不會洗版
          if (u.announce && !s.unlocks[a.key]) {
            systemBroadcast(s, `📖 主持人通知：【${u.title}】已開放，請翻到劇本的這一段。`);
          }
          s.unlocks[a.key] = true;
        } else {
          delete s.unlocks[a.key];
        }
        return;
      }
      case "broadcast": {
        const message = String(a.message ?? "").trim().slice(0, MAX_BROADCAST_LEN);
        if (!message) throw new GameError("BAD_REQUEST", "廣播內容不能是空的");
        pushBroadcast(s, message, "host");
        return;
      }
      case "freeSeat": {
        delete s.seats[a.roleId];
        lastSeen.delete(`${code}:${a.roleId}`);
        return;
      }
      case "end": {
        s.status = "ended";
        return;
      }
      default:
        throw new GameError("BAD_REQUEST", "未知的操作");
    }
  });
}

function release(s: OnlineSession, def: ScriptDef, clue: HostClue, to: string) {
  let recipients: string[];
  if (to === "default") {
    const targets = clue.targets ?? (clue.target ? [clue.target] : []);
    if (clue.audience === "all") recipients = ["all"];
    else if (clue.audience === "role" && targets.length) recipients = targets;
    else throw new GameError("BAD_REQUEST", "這條線索要指定發給誰");
  } else if (to === "all") {
    recipients = ["all"];
  } else if (def.roles.some((r) => r.id === to)) {
    recipients = [to];
  } else {
    throw new GameError("BAD_REQUEST", "沒有這個角色");
  }

  const prev = s.released[clue.id]?.to ?? [];
  const next =
    recipients.includes("all") || prev.includes("all")
      ? ["all"]
      : [...new Set([...prev, ...recipients])];
  s.released[clue.id] = { to: next, at: now() };
}

// ---------------- 玩家 ----------------

export async function lobby(code: string): Promise<OnlineLobby> {
  const s = await load(code);
  const def = getScript(s.script);
  return {
    code: s.code,
    script: s.script,
    title: def.title,
    status: s.status,
    roles: def.roles.map((r) => ({
      id: r.id,
      name: r.name,
      desc: r.desc,
      taken: Boolean(s.seats[r.id]),
      ...(r.image ? { image: assetUrl(code, LOBBY, r.image) } : {}),
    })),
  };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * 選角入場。已經有人坐的角色，只有暱稱一樣才放行（視為同一人換手機或清了瀏覽器），
 * 並拿回同一組通行憑證。
 */
export async function joinOnline(
  code: string,
  roleId: string,
  nickname: string,
): Promise<{ token: string }> {
  const name = (nickname ?? "").trim();
  if (!name || name.length > 20) throw new GameError("BAD_REQUEST", "暱稱請填 1–20 個字");

  const existing = await load(code);
  const def = getScript(existing.script);
  if (!def.roles.some((r) => r.id === roleId)) throw new GameError("BAD_REQUEST", "沒有這個角色");

  const seat = existing.seats[roleId];
  if (seat) {
    if (!sameName(seat.nickname, name)) {
      throw new GameError("ROLE_TAKEN", "這個角色已經有人選了；若是你本人，請輸入當初的暱稱");
    }
    return { token: seat.token };
  }
  if (existing.status === "ended") throw new GameError("SESSION_CLOSED", "場次已結束");

  return mutate(code, (s) => {
    // 鎖內再檢查一次，兩個人同時搶同一個角色時只有一個會成功
    const again = s.seats[roleId];
    if (again) {
      if (sameName(again.nickname, name)) return { token: again.token };
      throw new GameError("ROLE_TAKEN", "這個角色剛剛被選走了");
    }
    const token = randomBytes(18).toString("base64url");
    s.seats[roleId] = { nickname: name, token, joinedAt: now(), extra: [] };
    return { token };
  });
}

export async function assertPlayer(code: string, roleId: string, token: string) {
  const s = await load(code);
  const seat = s.seats[roleId];
  if (!seat || !token || !safeEqual(seat.token, token)) {
    throw new GameError("UNAUTHORIZED", "身分已失效，請重新選角入場");
  }
  return s;
}

/** 劇本段落對這個場次是否已開放（第二本之類的秘密段落，秘密鍵沒開也算沒開放） */
function docOpen(s: OnlineSession, d: DocDef): boolean {
  if (d.secretUntil && !s.unlocks[d.secretUntil]) return false;
  return d.unlockAny.some((k) => s.unlocks[k]);
}

function visibleTo(s: OnlineSession, clueId: string, roleId: string): boolean {
  const to = s.released[clueId]?.to;
  if (to && (to.includes("all") || to.includes(roleId))) return true;
  return Boolean(s.seats[roleId]?.extra.includes(clueId));
}

export async function playerSnapshot(
  code: string,
  roleId: string,
): Promise<OnlinePlayerSnapshot> {
  lastSeen.set(`${code}:${roleId}`, Date.now());
  const s = await load(code);
  const def = getScript(s.script);
  const role = def.roles.find((r) => r.id === roleId)!;
  const seat = s.seats[roleId];
  const all = await clueMap(def);

  const ids = new Set<string>([
    ...Object.keys(s.released).filter((id) => visibleTo(s, id, roleId)),
    ...(seat?.extra ?? []),
  ]);
  const clues: PlayerClue[] = [];
  for (const id of ids) {
    const c = all.get(id);
    if (!c) continue;
    clues.push({
      id: c.id,
      title: c.playerTitle ?? c.title,
      label: c.label,
      body: c.body,
      images: c.images.map((name) => assetUrl(code, roleId, name)),
      at: s.released[id]?.at ?? "",
    });
  }
  // 最新發的放最上面
  clues.sort((a, b) => b.at.localeCompare(a.at));

  const { hint, list } = def.docsFor(roleId);
  const docs: PlayerDoc[] = [];
  for (const d of list) {
    if (d.secretUntil && !s.unlocks[d.secretUntil]) continue;
    if (!docOpen(s, d)) {
      docs.push({ id: d.id, book: d.book, title: d.title, body: null });
      continue;
    }
    const images = signedImages(code, roleId, d.body);
    docs.push({ id: d.id, book: d.book, title: d.title, body: d.body, ...(images ? { images } : {}) });
  }

  return {
    rev: s.rev,
    code: s.code,
    script: s.script,
    status: s.status,
    phaseName: def.phases[s.phase]?.name ?? "",
    role: { id: role.id, name: role.name, desc: role.desc },
    nickname: seat?.nickname ?? "",
    hint,
    clues,
    docs,
    broadcasts: s.broadcasts,
    selfUnlock: def.selfUnlock,
  };
}

/** 玩家輸入主持人口頭給的線索代碼 */
export async function selfUnlock(code: string, roleId: string, clueCode: string) {
  const s = await load(code);
  const def = getScript(s.script);
  if (!def.selfUnlock) throw new GameError("BAD_REQUEST", "這個劇本不開放輸入代碼");
  assertActive(s);
  const id = (clueCode ?? "").trim().toUpperCase();
  const all = await clueMap(def);
  const clue = all.get(id);
  if (!clue) throw new GameError("BAD_CLUE", "代碼不正確，請確認後重新輸入");
  if (visibleTo(s, id, roleId)) throw new GameError("BAD_CLUE", "這條線索已經在你的清單裡了");
  await mutate(code, (d) => {
    const seat = d.seats[roleId];
    if (seat && !seat.extra.includes(id)) seat.extra.push(id);
  });
  return { title: clue.playerTitle ?? clue.title };
}

// ---------------- 圖片 ----------------

/**
 * 圖片用 <img> 載入，帶不了自訂 header，所以網址上附一個簽章。
 * 簽章綁定「場次＋身分」，拿到別人的網址也只能看到那個身分本來就看得到的圖。
 */
function secret(): string {
  g.__onlineSecret ??= process.env.ONLINE_ASSET_SECRET || randomBytes(32).toString("hex");
  return g.__onlineSecret;
}

function sign(code: string, who: string): string {
  return sha256(`${secret()}:${code}:${who}`).slice(0, 32);
}

function assetUrl(code: string, who: string, name: string): string {
  const q = new URLSearchParams({ who, sig: sign(code, who) });
  return `/api/online/${code}/asset/${encodeURIComponent(name)}?${q}`;
}

/** 選角畫面還沒有身分，用這個代號簽角色海報的網址 */
const LOBBY = "lobby";

/** 內文用到的圖片（[[img:…]] 標記）→ 已簽好的網址；沒有圖就不給這個欄位 */
function signedImages(code: string, who: string, text: string): Record<string, string> | undefined {
  const names = imageNames(text);
  if (!names.length) return undefined;
  return Object.fromEntries(names.map((n) => [n, assetUrl(code, who, n)]));
}

/** 圖檔放在 content/online/<劇本>/ 底下的哪個資料夾 */
export type AssetDir = "cards" | "images" | "posters";

/**
 * 回傳可以讀取的圖片在哪個資料夾；沒有權限則丟錯。
 *   線索卡圖（cards/）：主持人全部可看，玩家只能看已經發給自己的
 *   手冊板書（images/）：只有主持人
 *   劇本插圖（images/）：只有這個角色、而且那一段已經開放
 *   角色海報（posters/）：選角畫面，拿到場次代碼就能看
 */
export async function authorizeAsset(
  code: string,
  who: string,
  sig: string,
  name: string,
): Promise<{ script: OnlineScriptId; dir: AssetDir }> {
  if (!sig || !safeEqual(sign(code, who), sig)) {
    throw new GameError("UNAUTHORIZED", "圖片連結已失效，請重新整理");
  }
  const s = await load(code);
  const def = getScript(s.script);
  const script = s.script;

  if (who === LOBBY) {
    if (def.roles.some((r) => r.image === name)) return { script, dir: "posters" };
    throw new GameError("UNAUTHORIZED", "沒有這張圖");
  }

  const all = await clueMap(def);
  if ([...all.values()].some((c) => c.images.includes(name) && (who === "host" || visibleTo(s, c.id, who)))) {
    return { script, dir: "cards" };
  }
  if (who === "host") {
    if (def.handbook.some((h) => imageNames(h.note ?? "").includes(name))) return { script, dir: "images" };
  } else if (def.docsFor(who).list.some((d) => docOpen(s, d) && imageNames(d.body).includes(name))) {
    return { script, dir: "images" };
  }
  throw new GameError("UNAUTHORIZED", "這張圖還沒發給你");
}
