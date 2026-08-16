import { customAlphabet } from "nanoid";
import { DEFAULT_STAGE, LOG_TAIL, RESOURCE_MAP, STAGE_MAP } from "./config";
import { GameError } from "./errors";
import { getDriver } from "./store";
import type {
  LogEntry,
  LogType,
  Player,
  ResourceKey,
  SessionMeta,
  SessionSnapshot,
  SessionStatus,
} from "./types";

const nanoId = customAlphabet("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 6);
const nanoCode = customAlphabet("0123456789", 4);

/** 快取存活時間：超過就在背景重新從 Sheets 拉一次，順便撈到手動改表的內容 */
const CACHE_TTL_MS = Number(process.env.SESSION_CACHE_TTL_MS ?? 15_000);

interface CacheEntry {
  session: SessionMeta;
  players: Player[];
  log: LogEntry[];
  rev: number;
  loadedAt: number;
  refreshing?: Promise<void>;
}

const g = globalThis as unknown as {
  __jyCache?: Map<string, CacheEntry>;
  __jyLocks?: Map<string, Promise<unknown>>;
};
const cache: Map<string, CacheEntry> = (g.__jyCache ??= new Map());
const locks: Map<string, Promise<unknown>> = (g.__jyLocks ??= new Map());

/**
 * 同一個場次的寫入串成一條鏈，避免「讀取餘額 → 加減 → 寫回」被交錯執行而算錯。
 * 單一 Node process 內有效；多實例部署需改用 Sheets 以外的分散式鎖。
 */
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    key,
    next.catch(() => {}),
  );
  return next;
}

async function loadEntry(code: string): Promise<CacheEntry> {
  const driver = getDriver();
  const session = await driver.getSession(code);
  if (!session) throw new GameError("SESSION_NOT_FOUND", "無此場次");

  const [players, log] = await Promise.all([
    driver.listPlayers(code),
    driver.listLog(code, LOG_TAIL),
  ]);

  const prev = cache.get(code);
  const entry: CacheEntry = {
    session,
    players,
    log,
    rev: (prev?.rev ?? 0) + 1,
    loadedAt: Date.now(),
  };
  cache.set(code, entry);
  return entry;
}

/**
 * 讀取場次。命中快取就直接回傳（stale-while-revalidate），
 * 這樣不論幾個玩家在輪詢，打到 Google Sheets 的次數都固定，不會撞到 API 配額。
 */
async function getEntry(code: string, force = false): Promise<CacheEntry> {
  const hit = cache.get(code);
  if (!hit || force) return loadEntry(code);

  if (Date.now() - hit.loadedAt > CACHE_TTL_MS && !hit.refreshing) {
    hit.refreshing = loadEntry(code)
      .then(() => undefined)
      .catch((err) => {
        console.error("[九爺] 背景重新整理失敗", code, err);
      })
      .finally(() => {
        const cur = cache.get(code);
        if (cur) cur.refreshing = undefined;
      });
  }
  return hit;
}

function touch(entry: CacheEntry): void {
  entry.rev += 1;
  entry.session.updatedAt = new Date().toISOString();
}

function pushLog(entry: CacheEntry, log: LogEntry): void {
  entry.log.push(log);
  if (entry.log.length > LOG_TAIL) entry.log.splice(0, entry.log.length - LOG_TAIL);
}

function makeLog(partial: Partial<LogEntry> & { type: LogType }): LogEntry {
  return {
    ts: new Date().toISOString(),
    playerId: "",
    playerName: "",
    resource: "",
    delta: "",
    balanceAfter: "",
    reason: "",
    operator: "",
    ...partial,
  };
}

// ---------------- 場次 ----------------

export async function createSession(input: {
  code: string;
  title?: string;
  hostPin: string;
}): Promise<SessionMeta> {
  return withLock(input.code, async () => {
    const driver = getDriver();
    const existing = await driver.getSession(input.code);
    if (existing) {
      throw new GameError("SESSION_EXISTS", `場次 ${input.code} 已經開過了，請直接進入`);
    }

    const now = new Date().toISOString();
    const meta: SessionMeta = {
      code: input.code,
      title: input.title?.trim() || `${input.code} 場次`,
      status: "open",
      stageId: DEFAULT_STAGE,
      hostPin: input.hostPin,
      createdAt: now,
      updatedAt: now,
    };

    await driver.createSession(meta);
    await driver.appendLog(
      input.code,
      makeLog({ type: "session", reason: `開啟場次「${meta.title}」`, operator: "主持人" }),
    );
    cache.delete(input.code);
    await loadEntry(input.code);
    return meta;
  });
}

/** 玩家輸入場次時用的檢查，找不到就是「無此場次」 */
export async function findSession(code: string): Promise<SessionMeta> {
  const entry = await getEntry(code);
  return entry.session;
}

export async function listSessions(): Promise<Array<Omit<SessionMeta, "hostPin">>> {
  const all = await getDriver().listSessions();
  return all.map(({ hostPin: _hostPin, ...rest }) => rest);
}

export async function getSnapshot(code: string): Promise<SessionSnapshot> {
  const entry = await getEntry(code);
  const { hostPin: _hostPin, ...session } = entry.session;
  return {
    session,
    players: entry.players.filter((p) => p.status === "active"),
    log: [...entry.log].reverse(),
    rev: entry.rev,
    fetchedAt: new Date().toISOString(),
  };
}

export async function assertHost(code: string, pin: string): Promise<SessionMeta> {
  const entry = await getEntry(code);
  if (!pin || entry.session.hostPin !== pin) {
    throw new GameError("UNAUTHORIZED", "主持通行碼不正確");
  }
  return entry.session;
}

export async function assertPlayer(
  code: string,
  playerId: string,
  joinCode: string,
): Promise<Player> {
  const entry = await getEntry(code);
  const player = entry.players.find((p) => p.id === playerId);
  if (!player || player.status !== "active") {
    throw new GameError("PLAYER_NOT_FOUND", "找不到你的角色，請重新入場");
  }
  if (player.joinCode !== joinCode) {
    throw new GameError("UNAUTHORIZED", "通行碼不正確");
  }
  return player;
}

export async function setStage(code: string, stageId: string): Promise<SessionMeta> {
  const stage = STAGE_MAP[stageId];
  if (!stage) throw new GameError("BAD_REQUEST", "未知的階段");

  return withLock(code, async () => {
    const entry = await getEntry(code);
    entry.session.stageId = stageId;
    touch(entry);
    await getDriver().saveSession(entry.session);

    const log = makeLog({
      type: "stage",
      reason: `進入階段：${stage.label}`,
      operator: "主持人",
    });
    pushLog(entry, log);
    await getDriver().appendLog(code, log);
    return entry.session;
  });
}

export async function setSessionStatus(
  code: string,
  status: SessionStatus,
): Promise<SessionMeta> {
  return withLock(code, async () => {
    const entry = await getEntry(code);
    entry.session.status = status;
    touch(entry);
    await getDriver().saveSession(entry.session);

    const label = status === "open" ? "重新開放" : status === "paused" ? "暫停" : "結束";
    const log = makeLog({ type: "session", reason: `場次${label}`, operator: "主持人" });
    pushLog(entry, log);
    await getDriver().appendLog(code, log);
    return entry.session;
  });
}

// ---------------- 玩家 ----------------

export async function joinSession(
  code: string,
  name: string,
  faction = "",
): Promise<Player> {
  const trimmed = name.trim();
  if (!trimmed) throw new GameError("BAD_REQUEST", "請輸入你的稱號");
  if (trimmed.length > 20) throw new GameError("BAD_REQUEST", "稱號請控制在 20 字以內");

  return withLock(code, async () => {
    const entry = await getEntry(code);
    if (entry.session.status === "closed") {
      throw new GameError("SESSION_CLOSED", "本場次已結束");
    }

    const stage = STAGE_MAP[entry.session.stageId];
    if (stage && !stage.allowJoin) {
      throw new GameError("JOIN_CLOSED", `目前為「${stage.label}」階段，已不開放入場`);
    }

    const clash = entry.players.some(
      (p) => p.status === "active" && p.name === trimmed,
    );
    if (clash) throw new GameError("NAME_TAKEN", "這個稱號已經有人用了，換一個吧");

    const now = new Date().toISOString();
    const player: Player = {
      id: `P${nanoId()}`,
      name: trimmed,
      joinCode: nanoCode(),
      faction: faction.trim(),
      prestige: 0,
      influence: 0,
      status: "active",
      joinedAt: now,
      updatedAt: now,
    };

    await getDriver().createPlayer(code, player);
    entry.players.push(player);
    touch(entry);

    const log = makeLog({
      type: "join",
      playerId: player.id,
      playerName: player.name,
      reason: "入府報到",
      operator: "系統",
    });
    pushLog(entry, log);
    await getDriver().appendLog(code, log);
    return player;
  });
}

export async function removePlayer(code: string, playerId: string): Promise<void> {
  return withLock(code, async () => {
    const entry = await getEntry(code);
    const player = entry.players.find((p) => p.id === playerId);
    if (!player) throw new GameError("PLAYER_NOT_FOUND", "找不到該玩家");

    player.status = "removed";
    player.updatedAt = new Date().toISOString();
    await getDriver().savePlayer(code, player);
    touch(entry);

    const log = makeLog({
      type: "note",
      playerId: player.id,
      playerName: player.name,
      reason: "已被移出場次",
      operator: "主持人",
    });
    pushLog(entry, log);
    await getDriver().appendLog(code, log);
  });
}

// ---------------- 資源發放 ----------------

export interface GrantInput {
  /** 傳 "ALL" 代表全體在場玩家 */
  playerIds: string[] | "ALL";
  resource: ResourceKey;
  delta: number;
  reason?: string;
  operator?: string;
}

export async function applyGrant(
  code: string,
  input: GrantInput,
): Promise<{ affected: number }> {
  const def = RESOURCE_MAP[input.resource];
  if (!def) throw new GameError("BAD_REQUEST", "未知的資源類型");
  if (!Number.isFinite(input.delta) || input.delta === 0) {
    throw new GameError("BAD_REQUEST", "變動值必須是不為零的數字");
  }

  return withLock(code, async () => {
    const entry = await getEntry(code);
    if (entry.session.status === "closed") {
      throw new GameError("SESSION_CLOSED", "場次已結束，無法再調配資源");
    }

    const active = entry.players.filter((p) => p.status === "active");
    const targets =
      input.playerIds === "ALL"
        ? active
        : active.filter((p) => (input.playerIds as string[]).includes(p.id));

    if (targets.length === 0) throw new GameError("PLAYER_NOT_FOUND", "沒有選到任何玩家");

    const now = new Date().toISOString();
    const driver = getDriver();

    for (const player of targets) {
      player[input.resource] += input.delta;
      player.updatedAt = now;

      const log = makeLog({
        type: "grant",
        playerId: player.id,
        playerName: player.name,
        resource: def.label,
        delta: input.delta,
        balanceAfter: player[input.resource],
        reason: input.reason?.trim() || "主持人調配",
        operator: input.operator?.trim() || "主持人",
      });
      pushLog(entry, log);

      // 逐筆寫入，避免一次爆掉 Sheets 的寫入配額
      await driver.savePlayer(code, player);
      await driver.appendLog(code, log);
    }

    touch(entry);
    return { affected: targets.length };
  });
}
