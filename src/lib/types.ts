/** 遊戲核心型別定義 */

export type ResourceKey = "prestige" | "influence";

export interface ResourceDef {
  key: ResourceKey;
  /** 完整名稱，例如「威望值」 */
  label: string;
  /** 簡稱，例如「威望」 */
  short: string;
  /** CSS 變數名稱（不含 var()） */
  accent: string;
}

export type SessionStatus = "open" | "paused" | "closed";

/** 一個「場次」＝主持人開的一天，對應 Google Sheet 中的一組分頁 */
export interface SessionMeta {
  /** 場次代碼，正規化後的日期字串 YYYY-MM-DD */
  code: string;
  title: string;
  status: SessionStatus;
  stageId: string;
  /** 主持人通行碼（雛形階段為明碼，正式版需雜湊） */
  hostPin: string;
  createdAt: string;
  updatedAt: string;
}

export type PlayerStatus = "active" | "removed";

export interface Player {
  id: string;
  name: string;
  /** 玩家重新連線用的通行碼 */
  joinCode: string;
  faction: string;
  prestige: number;
  influence: number;
  status: PlayerStatus;
  joinedAt: string;
  updatedAt: string;
}

export type LogType = "session" | "join" | "grant" | "stage" | "note";

/** append-only 流水帳，永不覆寫，方便事後對帳 */
export interface LogEntry {
  ts: string;
  type: LogType;
  playerId: string;
  playerName: string;
  resource: string;
  delta: number | "";
  balanceAfter: number | "";
  reason: string;
  operator: string;
}

export interface SessionSnapshot {
  session: Omit<SessionMeta, "hostPin">;
  players: Player[];
  log: LogEntry[];
  /** 每次寫入遞增，前端可用來判斷是否需要重繪 */
  rev: number;
  fetchedAt: string;
}
