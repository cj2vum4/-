import type { Faction, HiddenBranch } from "../characters";
import type { LedgerSource } from "../config";
import type { LogEntry, Player, Report, ReportVerdict, SessionMeta } from "../types";

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

  listReports(code: string): Promise<Report[]>;
  createReport(code: string, report: Report): Promise<void>;
  saveReports(code: string, reports: Report[]): Promise<void>;

  listLog(code: string, limit: number): Promise<LogEntry[]>;
  /** 一次補上多筆紀錄，同樣是為了避免逐筆往返 */
  appendLogs(code: string, entries: LogEntry[]): Promise<void>;

  /**
   * 封存：把該場次的三個工作分頁彙整成一個以場次代碼命名的分頁，然後刪掉工作分頁。
   * 場次一多，每場三個分頁很快就看不完，收成一個才找得到東西。
   */
  archiveSession(code: string, sheet: ArchiveSheet): Promise<void>;
}

/** 封存分頁的內容，已排好版，driver 只負責寫進去 */
export interface ArchiveSheet {
  rows: (string | number)[][];
}

/** 分頁名稱規則：一個場次 = 兩個分頁 */
export const sessionsTabName = () => "場次總表";
export const playersTabName = (code: string) => `${code}_玩家`;
export const logTabName = (code: string) => `${code}_紀錄`;
export const reportsTabName = (code: string) => `${code}_舉報`;
/** 封存後的彙整分頁，名稱就是場次代碼（也就是當天日期） */
export const archiveTabName = (code: string) => code;

export const SESSION_HEADERS = [
  "場次代碼",
  "場次名稱",
  "狀態",
  "目前階段",
  "招募開放",
  "彩池階段",
  "彩池剩餘",
  "開場密碼",
  "建立時間",
  "更新時間",
  "聘書已發放",
  "已封存",
];
export const SESSION_LAST_COL = "L";

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
  "持有技能卡",
  "狀態",
  "加入時間",
  "更新時間",
  "暱稱",
  "聘書名次",
];
export const PLAYER_LAST_COL = "Q";

export const REPORT_HEADERS = [
  "舉報代碼",
  "時間",
  "舉報人代碼",
  "舉報人",
  "被舉報人代碼",
  "被舉報人",
  "線索卡編號",
  "判定結果",
  "判定時間",
  "已生效",
  "生效時間",
];
export const REPORT_LAST_COL = "K";

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
    m.poolStage,
    m.pool.join(","),
    m.password,
    m.createdAt,
    m.updatedAt,
    m.certsIssued ? "是" : "否",
    m.archived ? "是" : "否",
  ];
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;
/** 舊玩家列在「持有技能卡」的位置放的是調查次數，是純數字 */
const LEGACY_NUMERIC = /^\d+$/;

/**
 * 讀取場次列，同時相容新舊兩種欄位配置。
 *
 * 舊格式（8 欄）：… 招募開放 | 主持通行碼 | 建立時間 | 更新時間
 * 新格式（10 欄）：… 招募開放 | 彩池階段 | 彩池剩餘 | 主持通行碼 | 建立時間 | 更新時間
 *
 * 判斷方式：新格式第 7 欄是彩池（空字串或 "P:99,S:xxx" 這種 token），
 * 舊格式第 7 欄則是建立時間，長得像 ISO 時間戳。
 * 沒有這個相容處理的話，改版前建立的場次會讀到錯位的主持通行碼而進不去。
 */
export function rowToSession(row: unknown[]): SessionMeta | null {
  const code = str(row[0]);
  if (!code) return null;

  const legacy = ISO_TIMESTAMP.test(str(row[6]));
  return {
    code,
    title: str(row[1]),
    status: (str(row[2]) || "open") as SessionMeta["status"],
    stageId: str(row[3]),
    recruitOpen: bool(row[4]),
    poolStage: legacy ? "" : str(row[5]),
    pool: legacy ? [] : splitList(str(row[6])),
    password: str(legacy ? row[5] : row[7]),
    createdAt: str(legacy ? row[6] : row[8]),
    updatedAt: str(legacy ? row[7] : row[9]),
    // 後來追加的欄位，舊資料沒有值
    certsIssued: legacy ? false : bool(row[10]),
    archived: legacy ? false : bool(row[11]),
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
    p.heldCards.join(","),
    p.status,
    p.joinedAt,
    p.updatedAt,
    p.nickname,
    p.certRank,
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
    // 這一欄改版前是「已調查次數」（純數字），現在是「持有技能卡」。
    // 純數字代表是舊資料，當成沒有技能卡，否則會冒出 id 為 "0" 的假卡。
    heldCards: LEGACY_NUMERIC.test(str(row[11])) ? [] : splitList(str(row[11])),
    status: (str(row[12]) || "active") as Player["status"],
    joinedAt: str(row[13]),
    updatedAt: str(row[14]),
    // 以下為後來追加的欄位，舊資料沒有值，會落成空字串與 0
    nickname: str(row[15]),
    certRank: num(row[16]),
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

export function reportToRow(r: Report): (string | number)[] {
  return [
    r.id,
    r.ts,
    r.reporterId,
    r.reporterName,
    r.targetId,
    r.targetName,
    r.clueCode,
    r.verdict === "success" ? "成功" : r.verdict === "fail" ? "失敗" : "待判定",
    r.judgedAt,
    r.settled ? "是" : "否",
    r.settledAt,
  ];
}

export function rowToReport(row: unknown[]): Report | null {
  const id = str(row[0]);
  if (!id) return null;
  const verdictText = str(row[7]);
  const verdict: ReportVerdict =
    verdictText === "成功" ? "success" : verdictText === "失敗" ? "fail" : "";
  return {
    id,
    ts: str(row[1]),
    reporterId: str(row[2]),
    reporterName: str(row[3]),
    targetId: str(row[4]),
    targetName: str(row[5]),
    clueCode: str(row[6]),
    verdict,
    judgedAt: str(row[8]),
    settled: bool(row[9]),
    settledAt: str(row[10]),
  };
}

/** 試算表存的是逗號分隔字串，空字串要變成空陣列而不是 [""] */
function splitList(v: string): string[] {
  return v.split(",").map((x) => x.trim()).filter(Boolean);
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
