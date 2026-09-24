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
  reclaimable?: boolean;
  summary: string;
  body: string;
  images: string[];
  hostNote?: string;
  pageNum?: number;
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
}

export interface HandbookSection {
  title: string;
  note?: string;
  rows: string[][];
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
}

export interface PlayerClue {
  id: string;
  title: string;
  label: string;
  body: string;
  /** 已經帶好驗證參數的圖片網址 */
  images: string[];
  at: string;
}

export interface PlayerDoc {
  id: string;
  book: string;
  title: string;
  /** null = 尚未開放，只給標題 */
  body: string | null;
}

export interface OnlinePlayerSnapshot {
  rev: number;
  code: string;
  script: OnlineScriptId;
  status: "active" | "ended";
  phaseName: string;
  role: { id: string; name: string; desc: string };
  nickname: string;
  hint: string;
  clues: PlayerClue[];
  docs: PlayerDoc[];
  broadcasts: Broadcast[];
  selfUnlock: boolean;
}

/** 玩家選角畫面用：角色公開資訊與是否已被選走 */
export interface OnlineLobby {
  code: string;
  script: OnlineScriptId;
  title: string;
  status: "active" | "ended";
  roles: { id: string; name: string; desc: string; taken: boolean }[];
}

export interface OnlinePlayerIdentity {
  code: string;
  roleId: string;
  token: string;
}
