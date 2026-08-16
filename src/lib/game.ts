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
 *
 * 單一 Node process 內有效；多實例部署需要改成外部鎖。
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

/** 從資料庫重新載入整個場次。只能在鎖內呼叫。 */
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

/** 鎖內使用：快取有就用，沒有才載入。絕不觸發背景刷新，避免遞迴等待同一把鎖。 */
async function getEntryLocked(code: string): Promise<CacheEntry> {
  return cache.get(code) ?? loadEntry(code);
}

/**
 * 讀取路徑使用（未持鎖）。命中快取立刻回傳，過期則在鎖內背景刷新，
 * 因此不論多少玩家同時輪詢，對 Google Sheets 的讀取次數都固定。
 */
async function getEntry(code: string): Promise<CacheEntry> {
  const hit = cache.get(code);
  if (!hit) return withLock(code, () => loadEntry(code));

  if (Date.now() - hit.loadedAt > CACHE_TTL_MS && !refreshing.has(code)) {
    refreshing.add(code);
    void withLock(code, () => loadEntry(code))
      .catch((err) => {
        console.error("[九爺] 背景重新整理失敗", code, err);
      })
      .finally(() => refreshing.delete(code));
  }
  return hit;
}

function pushLog(entry: CacheEntry, ...logs: LogEntry[]): void {
  entry.log.push(...logs);
  if (entry.log.length > LOG_TAIL) entry.log.splice(0, entry.log.length - LOG_TAIL);
  entry.rev += 1;
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
    await driver.appendLogs(input.code, [
      makeLog({ type: "session", reason: `開啟場次「${meta.title}」`, operator: "主持人" }),
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
    const entry = await getEntryLocked(code);
    const next: SessionMeta = {
      ...entry.session,
      stageId,
      updatedAt: new Date().toISOString(),
    };
    const log = makeLog({ type: "stage", reason: `進入階段：${stage.label}`, operator: "主持人" });

    // 先確定寫進資料庫，成功後才更新快取，避免寫失敗時記憶體與試算表不一致
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
    const log = makeLog({ type: "session", reason: `場次${label}`, operator: "主持人" });

    await getDriver().saveSession(next);
    await getDriver().appendLogs(code, [log]);

    entry.session = next;
    pushLog(entry, log);
    return next;
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
    const entry = await getEntryLocked(code);
    if (entry.session.status === "closed") {
      throw new GameError("SESSION_CLOSED", "本場次已結束");
    }

    const stage = STAGE_MAP[entry.session.stageId];
    if (stage && !stage.allowJoin) {
      throw new GameError("JOIN_CLOSED", `目前為「${stage.label}」階段，已不開放入場`);
    }

    if (entry.players.some((p) => p.status === "active" && p.name === trimmed)) {
      throw new GameError("NAME_TAKEN", "這個稱號已經有人用了，換一個吧");
    }

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
    const log = makeLog({
      type: "join",
      playerId: player.id,
      playerName: player.name,
      reason: "入府報到",
      operator: "系統",
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

    const next: Player = {
      ...player,
      status: "removed",
      updatedAt: new Date().toISOString(),
    };
    const log = makeLog({
      type: "note",
      playerId: player.id,
      playerName: player.name,
      reason: "已被移出場次",
      operator: "主持人",
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
    const reason = input.reason?.trim() || "主持人調配";
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
        reason,
        operator,
      }),
    );

    // 餘額與紀錄各一次批次請求，寫在不同分頁所以能並行。
    // 這是 20 人全體發放能維持在一秒內的關鍵（逐筆寫要十幾秒）。
    const driver = getDriver();
    await Promise.all([driver.savePlayers(code, updated), driver.appendLogs(code, logs)]);

    targets.forEach((p, i) => Object.assign(p, updated[i]));
    pushLog(entry, ...logs);
    return { affected: targets.length };
  });
}
