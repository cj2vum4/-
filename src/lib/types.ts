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
  /**
   * 儲存代碼，同時也是封存後的分頁名稱。
   *
   * 由開場當天的日期產生：`2026-09-11`；同一天開第二場就是 `2026-09-11-2`。
   * 這是內部用的鍵，不是玩家要記的東西——玩家記的是 password。
   */
  code: string;
  title: string;
  status: SessionStatus;
  stageId: string;
  /**
   * 開場密碼。主持人開場時自訂，玩家用同一組進場。
   *
   * ⚠️ 目前主持台與玩家端共用這一組（依需求簡化）。也就是說知道密碼的玩家
   * 把網址改成 /host 就能看到全場的真實陣營。之後若要分成兩組，
   * 這裡拆成 password / hostPin 兩個欄位即可，其餘邏輯不用動。
   */
  password: string;
  /** 目前是否開放勢力招募 */
  recruitOpen: boolean;
  /** 目前彩池屬於哪個階段，換階段時用來判斷要不要重建 */
  poolStage: string;
  /** 剩餘的彩池牌堆，見 recruit.ts 的 PoolToken */
  pool: string[];
  /** 聘書是否已發放 */
  certsIssued: boolean;
  /** 是否已封存：三個工作分頁已彙整成一個並刪除，不能再進場 */
  archived: boolean;
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

/** 投票種類 */
export type VoteKind = "approve" | "oppose";

/**
 * 第一週的一張票。
 *
 * 一人一列，三張票就是三列。刻意記下投給誰——主持人在紀錄裡要看得到票型，
 * 但玩家端永遠拿不到（見 getPlayerSnapshot）。
 */
export interface Vote {
  id: string;
  ts: string;
  voterId: string;
  voterName: string;
  targetId: string;
  targetName: string;
  kind: VoteKind;
}

/** 投票進度。主持人看得到「還剩幾張沒投」，但看不到投給誰 */
export interface VoteProgress {
  playerId: string;
  playerName: string;
  approveLeft: number;
  opposeLeft: number;
  /** 這個人還能投幾張（人數不足時會少於手上的張數） */
  totalLeft: number;
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
  | "vote"
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
  /** 自己還有幾張票沒投（只在投票階段出現） */
  votesLeft?: { approve: number; oppose: number };
  /** 自己已經投過的對象代碼。用來把已投的人從名單上收起來 */
  votedTargetIds?: string[];
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
  hasVote: boolean;
  updatedAt: string;
  /** 這兩個旗標讓前端知道這一階段該顯示什麼，不必自己再查一次階段表 */
  peerPower: "value" | "hidden";
  showPrestige: boolean;
  certsIssued: boolean;
  /** 已封存：工作分頁已彙整並刪除，只剩試算表裡的那一個分頁 */
  archived: boolean;
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
  /** 角色代碼 → 劇本原訂陣營。只出現在主持人視角，玩家端拿不到 */
  scriptFactions: Record<string, Faction | "">;
  /** 每個人還剩幾張票沒投。主持人看得到進度，但看不到投給誰 */
  voteProgress: VoteProgress[];
  /** 全場都投完了嗎——沒投完不能進下一階段 */
  allVotesCast: boolean;
  log: LogEntry[];
  rev: number;
  fetchedAt: string;
}

export type SessionSnapshot = PlayerSnapshot | HostSnapshot;
