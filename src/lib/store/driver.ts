import type { Faction, HiddenBranch } from "../characters";
import type { LedgerSource } from "../config";
import type { LogEntry, Player, SessionMeta } from "../types";

/**
 * 儲存層介面。
 * 目前有兩個實作：MemoryDriver（開發／示範用）與 SheetsDriver（正式，Google Sheets）。
 * 上層 service 只認這個介面，換資料庫不用動業務邏輯。
 */
export interface StoreDriver {
  readonly kind: "memory" | "sheets";
  /** 初始化（建立總表分頁等），可重複呼叫 */
  init(): Promise<void>;

  listSessions(): Promise<SessionMeta[]>;
  getSession(code: string): Promise<SessionMeta | null>;
  createSession(meta: SessionMeta): Promise<void>;
  saveSession(meta: SessionMeta): Promise<void>;

  listPlayers(code: string): Promise<Player[]>;
  createPlayer(code: string, player: Player): Promise<void>;
  /** 一次寫回多位玩家。全體發放時若逐筆呼叫 API，人一多就要等十幾秒 */
  savePlayers(code: string, players: Player[]): Promise<void>;

  listLog(code: string, limit: number): Promise<LogEntry[]>;
  /** 一次補上多筆紀錄，同樣是為了避免逐筆往返 */
  appendLogs(code: string, entries: LogEntry[]): Promise<void>;
}

/** 分頁名稱規則：一個場次 = 兩個分頁 */
export const sessionsTabName = () => "場次總表";
export const playersTabName = (code: string) => `${code}_玩家`;
export const logTabName = (code: string) => `${code}_紀錄`;

export const SESSION_HEADERS = [
  "場次代碼",
  "場次名稱",
  "狀態",
  "目前階段",
  "招募開放",
  "主持通行碼",
  "建立時間",
  "更新時間",
];
export const SESSION_LAST_COL = "H";

export const PLAYER_HEADERS = [
  "玩家代碼",
  "角色",
  "角色代碼",
  "通行碼",
  "真實陣營",
  "隱藏分支",
  "分支已鎖定",
  "勢力值",
  "威望值",
  "血量",
  "剩餘抽取",
  "已調查次數",
  "狀態",
  "加入時間",
  "更新時間",
];
export const PLAYER_LAST_COL = "O";

export const LOG_HEADERS = [
  "時間",
  "類型",
  "玩家代碼",
  "角色",
  "資源",
  "變動",
  "變動後",
  "來源類型",
  "事由",
  "操作者",
  "可公開",
];
export const LOG_LAST_COL = "K";

// ---- row <-> object 轉換，兩個 driver 共用 ----

export function sessionToRow(m: SessionMeta): (string | number)[] {
  return [
    m.code,
    m.title,
    m.status,
    m.stageId,
    m.recruitOpen ? "是" : "否",
    m.hostPin,
    m.createdAt,
    m.updatedAt,
  ];
}

export function rowToSession(row: unknown[]): SessionMeta | null {
  const code = str(row[0]);
  if (!code) return null;
  return {
    code,
    title: str(row[1]),
    status: (str(row[2]) || "open") as SessionMeta["status"],
    stageId: str(row[3]),
    recruitOpen: bool(row[4]),
    hostPin: str(row[5]),
    createdAt: str(row[6]),
    updatedAt: str(row[7]),
  };
}

export function playerToRow(p: Player): (string | number)[] {
  return [
    p.id,
    p.name,
    p.characterId,
    p.joinCode,
    p.faction,
    p.hiddenBranch,
    p.hiddenBranchLocked ? "是" : "否",
    p.power,
    p.prestige,
    p.hp,
    p.drawsRemaining,
    p.investigationsUsed,
    p.status,
    p.joinedAt,
    p.updatedAt,
  ];
}

export function rowToPlayer(row: unknown[]): Player | null {
  const id = str(row[0]);
  if (!id) return null;
  return {
    id,
    name: str(row[1]),
    characterId: str(row[2]),
    joinCode: str(row[3]),
    faction: str(row[4]) as Faction | "",
    hiddenBranch: str(row[5]) as HiddenBranch | "",
    hiddenBranchLocked: bool(row[6]),
    power: num(row[7]),
    prestige: num(row[8]),
    hp: num(row[9]),
    drawsRemaining: num(row[10]),
    investigationsUsed: num(row[11]),
    status: (str(row[12]) || "active") as Player["status"],
    joinedAt: str(row[13]),
    updatedAt: str(row[14]),
  };
}

export function logToRow(e: LogEntry): (string | number)[] {
  return [
    e.ts,
    e.type,
    e.playerId,
    e.playerName,
    e.resource,
    e.delta,
    e.balanceAfter,
    e.source,
    e.reason,
    e.operator,
    e.publicVisible ? "是" : "否",
  ];
}

export function rowToLog(row: unknown[]): LogEntry | null {
  const ts = str(row[0]);
  if (!ts) return null;
  return {
    ts,
    type: (str(row[1]) || "note") as LogEntry["type"],
    playerId: str(row[2]),
    playerName: str(row[3]),
    resource: str(row[4]),
    delta: blank(row[5]) ? "" : num(row[5]),
    balanceAfter: blank(row[6]) ? "" : num(row[6]),
    source: str(row[7]) as LedgerSource | "",
    reason: str(row[8]),
    operator: str(row[9]),
    publicVisible: bool(row[10]),
  };
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function blank(v: unknown): boolean {
  return v === "" || v == null;
}

/** 試算表裡用「是／否」比 TRUE/FALSE 好讀，兩種都吃 */
function bool(v: unknown): boolean {
  const s = str(v).trim().toLowerCase();
  return s === "是" || s === "true" || s === "y" || s === "1";
}
