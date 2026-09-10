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
  /** 目前是否開放勢力招募 */
  recruitOpen: boolean;
  /** 目前彩池屬於哪個階段，換階段時用來判斷要不要重建 */
  poolStage: string;
  /** 剩餘的彩池牌堆，見 recruit.ts 的 PoolToken */
  pool: string[];
  /** 聘書是否已發放 */
  certsIssued: boolean;
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
  /** 本階段剩餘的招募抽取次數 */
  drawsRemaining: number;
  /** 抽到但還沒使用的技能卡（SKILL_CARDS 的 id），使用時要選目標 */
  heldCards: string[];
  status: PlayerStatus;
  joinedAt: string;
  updatedAt: string;
  /** 玩家本人的暱稱（不是角色名），聘書上印的是這個 */
  nickname: string;
  /** 聘書上的名次；0 代表還沒發放 */
  certRank: number;
}

/** 會長就任聘書 */
export interface Certificate {
  rank: number;
  nickname: string;
  characterName: string;
  position: string;
  title: string;
  /** 場次日期（YYYY-MM-DD）。用場次而不是寫入時間，聘書上的日期才不會被後續改值帶著跑 */
  date: string;
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
  | "faction"
  | "branch"
  | "report"
  | "recruit"
  | "skill"
  | "cert"
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

/**
 * 玩家彼此看得到的資訊。
 *
 * 欄位刻意都是選用的——可見度隨階段變動（見 STAGES 的 peerPower / showPrestige），
 * 不該看到的欄位在後端就不放進回應，而不是靠前端不顯示。
 */
export interface PublicPlayerView {
  id: string;
  characterId: string;
  name: string;
  status: PlayerStatus;
  /** 僅在該階段公開他人勢力值時才有 */
  power?: number;
  powerRank?: number;
  /** 僅在該階段顯示威望資訊時才有 */
  prestige?: number;
}

/** 玩家看自己的資訊。自己的勢力值與血量永遠看得到。 */
export interface SelfPlayerView {
  id: string;
  characterId: string;
  name: string;
  status: PlayerStatus;
  power: number;
  hp: number;
  /** 依階段而定；第一週前完全不提威望 */
  prestige?: number;
  powerRank?: number;
  hiddenBranch: HiddenBranch | "";
  drawsRemaining: number;
  heldCards: string[];
  nickname: string;
  /** 已發放的聘書；未發放時為 null */
  certificate: Certificate | null;
}

/**
 * 玩家看得到自己送出的舉報。
 * 判定結果在結算前不揭露——依規則要等開啟下一階段才公布，且不顯示明細。
 */
export interface MyReportView {
  id: string;
  ts: string;
  targetName: string;
  clueCode: string;
  /** 結算前一律為 ""，避免提前得知成敗 */
  verdict: ReportVerdict;
  settled: boolean;
}

/** 舉報成立後公開的線索卡 */
export interface RevealedClue {
  code: string;
  ownerName: string;
}

export interface SessionPublicMeta {
  code: string;
  title: string;
  status: SessionStatus;
  stageId: string;
  recruitOpen: boolean;
  updatedAt: string;
  /** 這兩個旗標讓前端知道這一階段該顯示什麼，不必自己再查一次階段表 */
  peerPower: "value" | "hidden";
  showPrestige: boolean;
  certsIssued: boolean;
}

/** 玩家端輪詢拿到的內容 */
export interface PlayerSnapshot {
  view: "player";
  session: SessionPublicMeta;
  me: SelfPlayerView;
  players: PublicPlayerView[];
  /** 只含自己送出的舉報 */
  myReports: MyReportView[];
  /** 已成立並公開的線索卡，全場都看得到 */
  revealedClues: RevealedClue[];
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
  revealedClues: RevealedClue[];
  /** 彩池剩餘張數，主持人可據以掌握進度 */
  poolLeft: number;
  log: LogEntry[];
  rev: number;
  fetchedAt: string;
}

export type SessionSnapshot = PlayerSnapshot | HostSnapshot;
