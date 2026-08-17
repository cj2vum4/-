/**
 * 劇本固定的 7 名角色。
 *
 * 玩家入場時是「選角色」而不是自己取暱稱，所以這份清單就是可選名單。
 * 基本設定（性別／年齡／職業／性格／外貌）目前留空，等劇本資料補上後填入，
 * 玩家介紹頁面會直接讀這裡。
 */
export interface CharacterDef {
  id: string;
  /** 角色姓名，同時作為場上顯示名稱 */
  name: string;
  difficulty: "低" | "中等" | "較高";
  /** 以下為劇本設定，待補 */
  gender?: string;
  age?: string;
  occupation?: string;
  personality?: string;
  appearance?: string;
  /** 是否使用隱藏分支機制（目前僅陸秉白） */
  hasHiddenBranch?: boolean;
}

export const CHARACTERS: CharacterDef[] = [
  { id: "zhouqian", name: "周謙", difficulty: "中等" },
  { id: "shenshiyue", name: "沈識月", difficulty: "中等" },
  { id: "jixiuyuan", name: "季修遠", difficulty: "中等" },
  { id: "liwanxu", name: "李婉序", difficulty: "中等" },
  { id: "shangyu", name: "商羽", difficulty: "中等" },
  { id: "chenjiashu", name: "陳嘉樹", difficulty: "中等" },
  { id: "lubingbai", name: "陸秉白", difficulty: "較高", hasHiddenBranch: true },
];

export const CHARACTER_MAP: Record<string, CharacterDef> = Object.fromEntries(
  CHARACTERS.map((c) => [c.id, c]),
);

export const PLAYER_COUNT = CHARACTERS.length;

/** 真實陣營。遊戲開始即固定，對玩家保密，只有主持人看得到。 */
export const FACTIONS = ["九爺", "紅姑娘", "隱藏鬼老"] as const;
export type Faction = (typeof FACTIONS)[number];

/**
 * 陸秉白專屬的隱藏分支，由主持人於第三週私下設定，設定後鎖定不可逆。
 * 刻意獨立成一個欄位而不是併進 faction，避免誤觸發或提前曝光。
 */
export const HIDDEN_BRANCHES = ["獨贏", "跟隨主陣營"] as const;
export type HiddenBranch = (typeof HIDDEN_BRANCHES)[number];
