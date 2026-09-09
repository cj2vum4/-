/** 遊戲核心型別定義 */

import type { Faction, HiddenBranch } from "./characters";
import type { LedgerSource } from "./config";

export type ResourceKey = "power" | "prestige" | "hp";

/** 數值的可見性：public = 人人看得到數字；self = 只有本人（與主持人）看得到 */
export type Visibility = "public" | "self";

export interface ResourceDef {
  key: ResourceKey;
  /** 完整名稱，例如「勢力值」 */
  label: string;
  /** 簡稱，例如「勢力」 */
  short: string;
  /** CSS 變數名稱（不含 var()） */
  accent: string;
  visibility: Visibility;
  description: string;
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
  /** 目前是否開放勢力招募（由主持人開啟／鎖定） */
  recruitOpen: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PlayerStatus = "active" | "removed";

/** 主持人視角的完整玩家資料 */
export interface Player {
  id: string;
  /** 對應 CHARACTERS 中的角色 */
  characterId: string;
  /** 角色姓名，等同顯示名稱 */
  name: string;
  /** 玩家重新連線用的通行碼 */
  joinCode: string;
  /** 真實陣營。對玩家保密，只有主持人看得到。 */
  faction: Faction | "";
  /** 陸秉白專屬，設定後不可逆 */
  hiddenBranch: HiddenBranch | "";
  hiddenBranchLocked: boolean;
  power: number;
  prestige: number;
  hp: number;
  /** 本輪招募剩餘的抽取次數，未用完會在下一輪開啟時自動代抽 */
  drawsRemaining: number;
  /** 已使用的調查次數，上限見 INVESTIGATION_LIMIT */
  investigationsUsed: number;
  status: PlayerStatus;
  joinedAt: string;
  updatedAt: string;
}

/**
 * 舉報紀錄。
 *
 * 依規則，威望值異動「不即時生效」，要等到下一次開啟招募時才批次更新，
 * 所以判定（verdict）與生效（settled）是兩個獨立階段。
 */
export type ReportVerdict = "" | "success" | "fail";

export interface Report {
  id: string;
  ts: string;
  reporterId: string;
  reporterName: string;
  targetId: string;
  targetName: string;
  /** 玩家填寫的線索卡編號 */
  clueCode: string;
  /** 空字串＝尚待主持人判定 */
  verdict: ReportVerdict;
  judgedAt: string;
  /** 威望值是否已於某次開啟招募時生效 */
  settled: boolean;
  settledAt: string;
}

export type LogType =
  | "session"
  | "join"
  | "grant"
  | "stage"
  | "recruit"
  | "faction"
  | "branch"
  | "report"
  | "investigate"
  | "note";

/** append-only 流水帳，永不覆寫，方便事後對帳與爭議追溯 */
export interface LogEntry {
  ts: string;
  type: LogType;
  playerId: string;
  playerName: string;
  resource: string;
  delta: number | "";
  balanceAfter: number | "";
  /** 來源類型，用於稽核 */
  source: LedgerSource | "";
  reason: string;
  operator: string;
  /** 是否可以讓其他玩家看到（勢力值與血量的異動屬於機密） */
  publicVisible: boolean;
}

/** 玩家彼此看得到的資訊：威望值公開，勢力值只給名次 */
export interface PublicPlayerView {
  id: string;
  characterId: string;
  name: string;
  prestige: number;
  /** 勢力值名次（1 起算），不含數值 */
  powerRank: number;
  status: PlayerStatus;
}

/** 玩家看自己的完整資訊 */
export interface SelfPlayerView extends PublicPlayerView {
  power: number;
  hp: number;
  hiddenBranch: HiddenBranch | "";
  drawsRemaining: number;
  investigationsUsed: number;
  investigationsLeft: number;
}

/** 玩家只看得到自己送出的舉報，看不到別人舉報了誰 */
export interface MyReportView {
  id: string;
  ts: string;
  targetName: string;
  clueCode: string;
  verdict: ReportVerdict;
  settled: boolean;
}

export interface SessionPublicMeta {
  code: string;
  title: string;
  status: SessionStatus;
  stageId: string;
  recruitOpen: boolean;
  updatedAt: string;
}

/** 玩家端輪詢拿到的內容 */
export interface PlayerSnapshot {
  view: "player";
  session: SessionPublicMeta;
  me: SelfPlayerView;
  players: PublicPlayerView[];
  /** 只含自己送出的舉報；被舉報與否要靠「調查線索」才知道 */
  myReports: MyReportView[];
  log: LogEntry[];
  rev: number;
  fetchedAt: string;
}

/** 主持台輪詢拿到的內容 */
export interface HostSnapshot {
  view: "host";
  session: SessionPublicMeta;
  players: Player[];
  reports: Report[];
  log: LogEntry[];
  rev: number;
  fetchedAt: string;
}

export type SessionSnapshot = PlayerSnapshot | HostSnapshot;
