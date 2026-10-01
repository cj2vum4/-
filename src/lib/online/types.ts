/**
 * 線上主持（瘋兔子、天才在左我在右）前後端共用的型別。
 *
 * 這裡只能放「形狀」，不能放任何劇本內容——這個檔會被 client component import，
 * 放進來的東西會原封不動打包進瀏覽器下載的 JS。劇本內容一律在
 * content/online/ 底下，由伺服器依身分挑出該給的部分再回傳。
 */

export type OnlineScriptId = "fengtuz" | "tiancai";

export interface OnlineRole {
  id: string;
  name: string;
  desc: string;
  /** 選角建議，只有主持人看得到 */
  hint?: string;
  /** 角色海報檔名（content/online/<劇本>/posters/），選角畫面顯示 */
  image?: string;
}

export interface OnlinePhase {
  name: string;
  desc: string;
  time?: string;
  /** 切到這個階段時自動打開的解鎖鍵 */
  unlock?: string;
}

/**
 * 發放對象的預設值：
 *   all  → 一鍵發給全體
 *   role → 一鍵發給 target 那個角色
 *   pick → 沒有預設，主持人自己選（瘋兔子的線索都是這種）
 */
export type ClueAudience = "all" | "role" | "pick";

/** 主持人端看到的完整線索（含主持筆記） */
export interface HostClue {
  id: string;
  title: string;
  /** 玩家端顯示的標題；主持端標題常帶編號或提示，不能直接給玩家看 */
  playerTitle?: string;
  group: string;
  label: string;
  audience: ClueAudience;
  target?: string;
  /** 同一張卡要發給多個角色（例如瘋兔子的兩人一組任務卡），優先於 target */
  targets?: string[];
  reclaimable?: boolean;
  summary: string;
  body: string;
  images: string[];
  hostNote?: string;
  pageNum?: number;
  /** 打開後不是文字而是互動元件：poker = 第一幕的撲克牌比大小、circle = 第三～五幕的飛昇法陣 */
  widget?: "poker" | "circle";
}

export interface ClueGroup {
  id: string;
  label: string;
}

export interface UnlockDef {
  key: string;
  title: string;
  group: string;
  desc: string;
  /**
   * 要在某個步驟單獨開放的段落（例如小劇場）：填遊戲階段名稱，
   * 開放按鈕就放在主持台那個階段的卡片裡，而且不會被線索分頁的「全部開放」一起打開
   */
  phase?: string;
  /** 開放時廣播提醒全體玩家翻到這一段。只有單一角色才有的段落不要設，免得劇透 */
  announce?: boolean;
}

export interface HandbookSection {
  title: string;
  /** 內文；單獨一行的 [[img:檔名|圖說]] 會顯示成圖片（見 rich.ts） */
  note?: string;
  rows: string[][];
  /** 伺服器回傳時才有：內文圖片檔名 → 已帶驗證參數的網址 */
  images?: Record<string, string>;
}

export interface BroadcastTemplate {
  label: string;
  message: string;
}

export interface Broadcast {
  id: string;
  message: string;
  at: string;
  kind: "host" | "system";
}

/** 主持台一次載入的目錄：線索全集、階段、解鎖項目、手冊 */
export interface HostCatalog {
  script: OnlineScriptId;
  title: string;
  roles: OnlineRole[];
  phases: OnlinePhase[];
  groups: ClueGroup[];
  unlocks: UnlockDef[];
  clues: HostClue[];
  templates: BroadcastTemplate[];
  handbook: HandbookSection[];
  /** 線索來源的狀態，例如瘋兔子尚未匯入線索時要讓主持人知道 */
  clueSourceNote?: string;
}

export interface HostSeat {
  roleId: string;
  nickname: string;
  joinedAt: string;
  online: boolean;
  /** 玩家自己輸入代碼解鎖的線索 */
  extra: string[];
}

export interface Release {
  /** "all" 或角色 id */
  to: string[];
  at: string;
}

export interface OnlineHostSnapshot {
  rev: number;
  code: string;
  script: OnlineScriptId;
  status: "active" | "ended";
  phase: number;
  released: Record<string, Release>;
  unlocks: Record<string, boolean>;
  broadcasts: Broadcast[];
  seats: HostSeat[];
  /** 撲克牌局（還沒動過就是 null，主持台顯示一副新牌） */
  poker: PokerState | null;
  /** 飛昇法陣（還沒人動過就是 null，主持台顯示空白陣法）；只有有法陣線索的劇本才有這個欄位 */
  circle?: CircleView | null;
  /** 有這個欄位的劇本，線索分頁依幕摺疊：本幕展開，前面與後面幾幕收起來 */
  clueGroups?: PlayerClueGroup[];
}

/**
 * 撲克牌局的三個狀態：
 *   inspect 驗牌：大家看得到整副牌的牌面，可以洗牌
 *   deal    發牌：牌面蓋起來，主持人（陸江遠）和玩家一對一比大小
 *   reveal  毒牌標記之後：玩家端改成公開棄牌堆與新牌堆
 */
export type PokerMode = "inspect" | "deal" | "reveal";

export interface PokerRound {
  roleId: string;
  /** 玩家的牌，第一張是起始牌（蓋著，只有自己看得到） */
  player: string[];
  /** 主持人（陸江遠）的牌，第一張是起始牌 */
  dealer: string[];
  playerStop: boolean;
  dealerStop: boolean;
  /** 已翻牌比點 */
  revealed: boolean;
}

/** 飛昇法陣的一組「兇手→死者」；值是名字 id（角色 id 或 liao），空字串是還沒填 */
export interface CirclePair {
  killer: string;
  victim: string;
}

export interface CircleState {
  /** 六芒星六個角，順時針從頂端開始 */
  star: CirclePair[];
  /** 中央（第四幕板書加上的「夏→廖」） */
  center: CirclePair;
  /** 分身→夢主 對照表：key 是角色 id 或 others（其他分身），夢主最多兩個 */
  dreams: Record<string, string[]>;
  /** 主持人鎖定後玩家不能改（喊「白日飛昇」時） */
  locked: boolean;
  /** 每一格最後是誰改的（s0–s5、center、d:<列>） */
  by: Record<string, string>;
  log: PokerLogEntry[];
}

/** 給畫面用：陣法加上可選的名字與對照表的列 */
export interface CircleView extends CircleState {
  names: { id: string; name: string; short: string }[];
  rows: string[];
}

export type CircleOp =
  | { op: "pair"; slot: string; field: "killer" | "victim"; value: string }
  | { op: "dream"; row: string; value: string[] }
  | { op: "lock"; on: boolean }
  | { op: "clear" };

export interface PokerLogEntry {
  who: string;
  action: string;
  at: string;
}

export interface PokerState {
  mode: PokerMode;
  /** 新牌堆（還沒發的牌），第一張是牌堆頂 */
  deck: string[];
  /** 棄牌堆 */
  discard: string[];
  round: PokerRound | null;
  /** 被做了毒牌標記的那張牌 */
  poison: string | null;
  log: PokerLogEntry[];
}

/** 玩家看到的牌局：看不到牌面的牌是 null */
export interface PlayerPoker {
  mode: PokerMode;
  deck: (string | null)[];
  discard: (string | null)[];
  round:
    | (Omit<PokerRound, "player" | "dealer"> & { roleName: string; player: (string | null)[]; dealer: (string | null)[] })
    | null;
  poison: string | null;
  log: PokerLogEntry[];
}

export interface PlayerClue {
  id: string;
  title: string;
  label: string;
  /** 線索分組（各幕） */
  group: string;
  body: string;
  /** 已經帶好驗證參數的圖片網址 */
  images: string[];
  at: string;
  widget?: "poker" | "circle";
}

/** 玩家線索清單的分組；past = 已經是前面幾幕，預設收起來 */
export interface PlayerClueGroup {
  id: string;
  label: string;
  past: boolean;
}

export interface PlayerDoc {
  id: string;
  book: string;
  title: string;
  /** null = 尚未開放，只給標題。單獨一段的 [[img:檔名]] 是插圖 */
  body: string | null;
  /** 已開放段落裡的插圖：檔名 → 已帶驗證參數的網址 */
  images?: Record<string, string>;
}

export interface OnlinePlayerSnapshot {
  rev: number;
  code: string;
  script: OnlineScriptId;
  status: "active" | "ended";
  phaseName: string;
  /** image：自己角色的海報網址（已帶驗證參數），沒有海報的劇本不給 */
  role: { id: string; name: string; desc: string; image?: string };
  nickname: string;
  hint: string;
  clues: PlayerClue[];
  docs: PlayerDoc[];
  broadcasts: Broadcast[];
  selfUnlock: boolean;
  /** 有這個欄位的劇本，玩家端線索依幕分組、前面幾幕收起來 */
  clueGroups?: PlayerClueGroup[];
  /** 撲克牌線索發給這個玩家之後才有 */
  poker?: PlayerPoker;
  /** 飛昇法陣線索發給這個玩家之後才有 */
  circle?: CircleView;
}

/** 玩家選角畫面用：角色公開資訊與是否已被選走 */
export interface OnlineLobby {
  code: string;
  script: OnlineScriptId;
  title: string;
  status: "active" | "ended";
  /** image：角色海報網址（已帶驗證參數），沒有海報的劇本不給 */
  roles: { id: string; name: string; desc: string; taken: boolean; image?: string }[];
}

export interface OnlinePlayerIdentity {
  code: string;
  roleId: string;
  token: string;
}
