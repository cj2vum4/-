import { customAlphabet } from "nanoid";
import { CHARACTER_MAP, FACTIONS, HIDDEN_BRANCHES, type Faction, type HiddenBranch } from "./characters";
import {
  DEFAULT_LEDGER_SOURCE,
  DEFAULT_STAGE,
  LOG_TAIL,
  RESOURCE_MAP,
  STAGE_MAP,
  type LedgerSource,
} from "./config";
import { GameError } from "./errors";
import { getDriver } from "./store";
import type {
  HostSnapshot,
  LogEntry,
  LogType,
  Player,
  PlayerSnapshot,
  PublicPlayerView,
  ResourceKey,
  SelfPlayerView,
  SessionMeta,
  SessionPublicMeta,
  SessionStatus,
} from "./types";

const nanoId = customAlphabet("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 6);
const nanoCode = customAlphabet("0123456789", 4);

/** 快取存活時間：超過就重新從 Sheets 拉一次，順便撈到主持人手動改表的內容 */
const CACHE_TTL_MS = Number(process.env.SESSION_CACHE_TTL_MS ?? 15_000);

interface CacheEntry {
  session: SessionMeta;
  players: Player[];
  log: LogEntry[];
  rev: number;
  loadedAt: number;
}

const g = globalThis as unknown as {
  __jyCache?: Map<string, CacheEntry>;
  __jyLocks?: Map<string, Promise<unknown>>;
  __jyRefreshing?: Set<string>;
};
const cache: Map<string, CacheEntry> = (g.__jyCache ??= new Map());
const locks: Map<string, Promise<unknown>> = (g.__jyLocks ??= new Map());
const refreshing: Set<string> = (g.__jyRefreshing ??= new Set());

/**
 * 同一個場次的所有存取都串成一條鏈。
 *
 * 不只寫入要鎖 —— 背景重新整理也必須走這條鏈。否則會發生：
 * 刷新在 t0 讀到舊餘額 → t1 有人發放並寫回 → t2 刷新結果蓋掉快取 →
 * 下一筆發放從被蓋掉的舊值往上加，前一筆就消失了（lost update）。
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
  if (!session) {
    cache.delete(code);
    throw new GameError("SESSION_NOT_FOUND", "無此場次");
  }

  const [players, log] = await Promise.all([
    driver.listPlayers(code),
    driver.listLog(code, LOG_TAIL),
  ]);

  const entry: CacheEntry = {
    session,
    players,
    log,
    rev: (cache.get(code)?.rev ?? 0) + 1,
    loadedAt: Date.now(),
  };
  cache.set(code, entry);
  return entry;
}

/** 鎖內使用：快取有就用，沒有才載入。絕不觸發背景刷新，避免等待同一把鎖。 */
async function getEntryLocked(code: string): Promise<CacheEntry> {
  return cache.get(code) ?? loadEntry(code);
}

/** 讀取路徑使用（未持鎖）。命中快取立刻回傳，過期則在鎖內背景刷新。 */
async function getEntry(code: string): Promise<CacheEntry> {
  const hit = cache.get(code);
  if (!hit) return withLock(code, () => loadEntry(code));

  if (Date.now() - hit.loadedAt > CACHE_TTL_MS && !refreshing.has(code)) {
    refreshing.add(code);
    void withLock(code, () => loadEntry(code))
      .catch((err) => console.error("[九爺] 背景重新整理失敗", code, err))
      .finally(() => refreshing.delete(code));
  }
  return hit;
}

function pushLog(entry: CacheEntry, ...logs: LogEntry[]): void {
  entry.log.push(...logs);
  if (entry.log.length > LOG_TAIL) entry.log.splice(0, entry.log.length - LOG_TAIL);
  entry.rev += 1;
}

function makeLog(
  partial: Partial<LogEntry> & { type: LogType; publicVisible: boolean },
): LogEntry {
  return {
    ts: new Date().toISOString(),
    playerId: "",
    playerName: "",
    resource: "",
    delta: "",
    balanceAfter: "",
    source: "",
    reason: "",
    operator: "",
    ...partial,
  };
}

function publicMeta(s: SessionMeta): SessionPublicMeta {
  return {
    code: s.code,
    title: s.title,
    status: s.status,
    stageId: s.stageId,
    recruitOpen: s.recruitOpen,
    updatedAt: s.updatedAt,
  };
}

/**
 * 勢力值名次（1 起算，同分同名次）。
 * 玩家之間只看得到名次，看不到彼此的勢力值數字。
 */
function powerRanks(players: Player[]): Map<string, number> {
  const sorted = [...players].sort((a, b) => b.power - a.power);
  const ranks = new Map<string, number>();
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    ranks.set(p.id, prev && prev.power === p.power ? ranks.get(prev.id)! : i + 1);
  });
  return ranks;
}

// ---------------- 場次 ----------------

export async function createSession(input: {
  code: string;
  title?: string;
  hostPin: string;
}): Promise<SessionMeta> {
  return withLock(input.code, async () => {
    const driver = getDriver();
    if (await driver.getSession(input.code)) {
      throw new GameError("SESSION_EXISTS", `場次 ${input.code} 已經開過了，請直接進入`);
    }

    const now = new Date().toISOString();
    const meta: SessionMeta = {
      code: input.code,
      title: input.title?.trim() || `${input.code} 場次`,
      status: "open",
      stageId: DEFAULT_STAGE,
      recruitOpen: false,
      hostPin: input.hostPin,
      createdAt: now,
      updatedAt: now,
    };

    await driver.createSession(meta);
    await driver.appendLogs(input.code, [
      makeLog({
        type: "session",
        reason: `開啟場次「${meta.title}」`,
        operator: "主持人",
        publicVisible: true,
      }),
    ]);

    cache.delete(input.code);
    await loadEntry(input.code);
    return meta;
  });
}

/** 玩家輸入場次時用的檢查，找不到就是「無此場次」 */
export async function findSession(code: string): Promise<SessionMeta> {
  return (await getEntry(code)).session;
}

export async function listSessions(): Promise<Array<Omit<SessionMeta, "hostPin">>> {
  const all = await getDriver().listSessions();
  return all.map(({ hostPin: _hostPin, ...rest }) => rest);
}

/** 哪些角色還沒被選走 */
export async function availableCharacters(code: string): Promise<string[]> {
  const entry = await getEntry(code);
  const taken = new Set(
    entry.players.filter((p) => p.status === "active").map((p) => p.characterId),
  );
  return Object.keys(CHARACTER_MAP).filter((id) => !taken.has(id));
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

// ---------------- 快照（依身分決定看得到什麼） ----------------

export async function getHostSnapshot(code: string): Promise<HostSnapshot> {
  const entry = await getEntry(code);
  return {
    view: "host",
    session: publicMeta(entry.session),
    players: entry.players.filter((p) => p.status === "active"),
    log: [...entry.log].reverse(),
    rev: entry.rev,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 玩家視角。這裡是全系統最需要小心的地方：
 * 勢力值與血量只能給本人，其他人一律只給威望值與勢力值名次。
 */
export async function getPlayerSnapshot(
  code: string,
  playerId: string,
): Promise<PlayerSnapshot> {
  const entry = await getEntry(code);
  const active = entry.players.filter((p) => p.status === "active");
  const me = active.find((p) => p.id === playerId);
  if (!me) throw new GameError("PLAYER_NOT_FOUND", "找不到你的角色，請重新入場");

  const ranks = powerRanks(active);
  const toPublic = (p: Player): PublicPlayerView => ({
    id: p.id,
    characterId: p.characterId,
    name: p.name,
    prestige: p.prestige,
    powerRank: ranks.get(p.id) ?? 0,
    status: p.status,
  });

  const self: SelfPlayerView = {
    ...toPublic(me),
    power: me.power,
    hp: me.hp,
    hiddenBranch: me.hiddenBranch,
    drawsRemaining: me.drawsRemaining,
    investigationsUsed: me.investigationsUsed,
  };

  return {
    view: "player",
    session: publicMeta(entry.session),
    me: self,
    // 陣營、隱藏分支、勢力值數字、血量都不在這裡，連傳都不傳
    players: active.map(toPublic),
    // 只給得到「可公開的紀錄」與「與自己有關的紀錄」
    log: [...entry.log]
      .filter((e) => e.publicVisible || e.playerId === playerId)
      .reverse(),
    rev: entry.rev,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------- 階段與場次控制 ----------------

export async function setStage(code: string, stageId: string): Promise<SessionMeta> {
  const stage = STAGE_MAP[stageId];
  if (!stage) throw new GameError("BAD_REQUEST", "未知的階段");

  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    // 換階段時招募一律先關閉，避免上一階段的招募狀態延續到下一階段
    const next: SessionMeta = {
      ...entry.session,
      stageId,
      recruitOpen: false,
      updatedAt: new Date().toISOString(),
    };
    const log = makeLog({
      type: "stage",
      reason: `進入階段 ${stage.index}：${stage.label}`,
      operator: "主持人",
      publicVisible: true,
    });

    await getDriver().saveSession(next);
    await getDriver().appendLogs(code, [log]);

    entry.session = next;
    pushLog(entry, log);
    return next;
  });
}

export async function setRecruitOpen(code: string, open: boolean): Promise<SessionMeta> {
  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    const stage = STAGE_MAP[entry.session.stageId];
    if (open && !stage?.hasRecruit) {
      throw new GameError("BAD_REQUEST", `「${stage?.label ?? entry.session.stageId}」沒有勢力招募`);
    }

    const next: SessionMeta = {
      ...entry.session,
      recruitOpen: open,
      updatedAt: new Date().toISOString(),
    };
    const log = makeLog({
      type: "recruit",
      reason: open ? `開啟招募：${stage?.label}` : `鎖定招募：${stage?.label}`,
      operator: "主持人",
      publicVisible: true,
    });

    await getDriver().saveSession(next);
    await getDriver().appendLogs(code, [log]);

    entry.session = next;
    pushLog(entry, log);
    return next;
  });
}

export async function setSessionStatus(
  code: string,
  status: SessionStatus,
): Promise<SessionMeta> {
  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    const next: SessionMeta = {
      ...entry.session,
      status,
      updatedAt: new Date().toISOString(),
    };
    const label = status === "open" ? "重新開放" : status === "paused" ? "暫停" : "結束";
    const log = makeLog({
      type: "session",
      reason: `場次${label}`,
      operator: "主持人",
      publicVisible: true,
    });

    await getDriver().saveSession(next);
    await getDriver().appendLogs(code, [log]);

    entry.session = next;
    pushLog(entry, log);
    return next;
  });
}

// ---------------- 玩家 ----------------

export async function joinSession(code: string, characterId: string): Promise<Player> {
  const character = CHARACTER_MAP[characterId];
  if (!character) throw new GameError("BAD_REQUEST", "沒有這個角色");

  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    if (entry.session.status === "closed") {
      throw new GameError("SESSION_CLOSED", "本場次已結束");
    }

    const stage = STAGE_MAP[entry.session.stageId];
    if (stage && !stage.allowJoin) {
      throw new GameError("JOIN_CLOSED", `目前為「${stage.label}」階段，已不開放入場`);
    }

    if (entry.players.some((p) => p.status === "active" && p.characterId === characterId)) {
      throw new GameError("NAME_TAKEN", `「${character.name}」已經有人選了，請換一位`);
    }

    const now = new Date().toISOString();
    const player: Player = {
      id: `P${nanoId()}`,
      characterId,
      name: character.name,
      joinCode: nanoCode(),
      faction: "",
      hiddenBranch: "",
      hiddenBranchLocked: false,
      power: 0,
      prestige: 0,
      hp: 0,
      drawsRemaining: 0,
      investigationsUsed: 0,
      status: "active",
      joinedAt: now,
      updatedAt: now,
    };
    const log = makeLog({
      type: "join",
      playerId: player.id,
      playerName: player.name,
      reason: "入府報到",
      operator: "系統",
      publicVisible: true,
    });

    await getDriver().createPlayer(code, player);
    await getDriver().appendLogs(code, [log]);

    entry.players.push(player);
    pushLog(entry, log);
    return player;
  });
}

export async function removePlayer(code: string, playerId: string): Promise<void> {
  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    const player = entry.players.find((p) => p.id === playerId);
    if (!player) throw new GameError("PLAYER_NOT_FOUND", "找不到該玩家");

    const next: Player = { ...player, status: "removed", updatedAt: new Date().toISOString() };
    const log = makeLog({
      type: "note",
      playerId: player.id,
      playerName: player.name,
      reason: "已被移出場次",
      operator: "主持人",
      publicVisible: true,
    });

    await getDriver().savePlayers(code, [next]);
    await getDriver().appendLogs(code, [log]);

    Object.assign(player, next);
    pushLog(entry, log);
  });
}

/** 設定真實陣營。只有主持人能做，紀錄不對玩家公開。 */
export async function setFaction(
  code: string,
  playerId: string,
  faction: Faction | "",
): Promise<void> {
  if (faction !== "" && !FACTIONS.includes(faction)) {
    throw new GameError("BAD_REQUEST", "未知的陣營");
  }

  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    const player = entry.players.find((p) => p.id === playerId);
    if (!player) throw new GameError("PLAYER_NOT_FOUND", "找不到該玩家");

    const next: Player = { ...player, faction, updatedAt: new Date().toISOString() };
    const log = makeLog({
      type: "faction",
      playerId: player.id,
      playerName: player.name,
      reason: faction ? `設定陣營：${faction}` : "清除陣營",
      operator: "主持人",
      // 陣營是對玩家保密的資訊，連自己都不該從紀錄中看到
      publicVisible: false,
    });

    await getDriver().savePlayers(code, [next]);
    await getDriver().appendLogs(code, [log]);

    Object.assign(player, next);
    pushLog(entry, log);
  });
}

/**
 * 設定陸秉白的隱藏分支。依規則「設定後鎖定不可逆」，
 * 所以這裡刻意不提供修改，第二次呼叫會被擋下來。
 */
export async function setHiddenBranch(
  code: string,
  playerId: string,
  branch: HiddenBranch,
): Promise<void> {
  if (!HIDDEN_BRANCHES.includes(branch)) {
    throw new GameError("BAD_REQUEST", "未知的隱藏分支");
  }

  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    const player = entry.players.find((p) => p.id === playerId);
    if (!player) throw new GameError("PLAYER_NOT_FOUND", "找不到該玩家");

    const character = CHARACTER_MAP[player.characterId];
    if (!character?.hasHiddenBranch) {
      throw new GameError("BAD_REQUEST", `${player.name} 沒有隱藏分支機制`);
    }
    if (player.hiddenBranchLocked) {
      throw new GameError(
        "BAD_REQUEST",
        `隱藏分支已鎖定為「${player.hiddenBranch}」，依規則不可更改`,
      );
    }

    const next: Player = {
      ...player,
      hiddenBranch: branch,
      hiddenBranchLocked: true,
      updatedAt: new Date().toISOString(),
    };
    const log = makeLog({
      type: "branch",
      playerId: player.id,
      playerName: player.name,
      reason: `隱藏分支鎖定為「${branch}」`,
      operator: "主持人",
      publicVisible: false,
    });

    await getDriver().savePlayers(code, [next]);
    await getDriver().appendLogs(code, [log]);

    Object.assign(player, next);
    pushLog(entry, log);
  });
}

// ---------------- 資源發放 ----------------

export interface GrantInput {
  /** 傳 "ALL" 代表全體在場玩家 */
  playerIds: string[] | "ALL";
  resource: ResourceKey;
  delta: number;
  source?: LedgerSource;
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
    const entry = await getEntryLocked(code);
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
    const source = input.source ?? DEFAULT_LEDGER_SOURCE;
    const reason = input.reason?.trim() || source;
    const operator = input.operator?.trim() || "主持人";

    // 先算出新狀態（不動快取），確認寫入成功後才套用
    const updated: Player[] = targets.map((p) => {
      const next: Player = { ...p, updatedAt: now };
      next[input.resource] = p[input.resource] + input.delta;
      return next;
    });

    const logs = updated.map((p) =>
      makeLog({
        type: "grant",
        playerId: p.id,
        playerName: p.name,
        resource: def.label,
        delta: input.delta,
        balanceAfter: p[input.resource],
        source,
        reason,
        operator,
        // 威望值公開，勢力值與血量只有本人看得到
        publicVisible: def.visibility === "public",
      }),
    );

    // 餘額與紀錄各一次批次請求，寫在不同分頁所以能並行
    const driver = getDriver();
    await Promise.all([driver.savePlayers(code, updated), driver.appendLogs(code, logs)]);

    targets.forEach((p, i) => Object.assign(p, updated[i]));
    pushLog(entry, ...logs);
    return { affected: targets.length };
  });
}
