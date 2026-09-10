/**
 * 劇本固定的 7 名角色。
 *
 * 玩家入場時是「選角色」而不是自己取暱稱，所以這份清單就是可選名單。
 * 角色皆可反串，性別欄位是角色設定，不是選角限制。
 */
export type Difficulty = "低" | "中" | "高";

export interface CharacterDef {
  id: string;
  /** 角色姓名，同時作為場上顯示名稱 */
  name: string;
  difficulty: Difficulty;
  gender: "男" | "女";
  age: number;
  /** 職業／身分 */
  occupation: string;
  personality: string;
  appearance: string;
  /** 額外備註，例如婚姻狀態 */
  note?: string;
  /** 角色海報。目前指向外部圖床，之後可換成專案內的檔案。 */
  poster?: string;
  /** 是否使用隱藏分支機制（目前僅陸秉白） */
  hasHiddenBranch?: boolean;
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: "zhouqian",
    name: "周謙",
    difficulty: "低",
    gender: "男",
    age: 24,
    occupation: "船業老闆",
    personality: "溫和謙遜，彬彬有禮，但生氣時說話刻薄",
    appearance: "戴著金絲邊眼鏡，短髮，穿著一絲不苟的西裝",
    poster: "https://i.postimg.cc/h47zNmMH/zhou-qian.jpg",
  },
  {
    id: "shenshiyue",
    name: "沈識月",
    difficulty: "中",
    gender: "女",
    age: 22,
    occupation: "商會庫管",
    personality: "溫柔恬靜，優雅端莊的大家小姐",
    appearance: "長髮綰成低髮髻，身穿白色旗袍，外罩披肩",
    note: "已婚",
    poster: "https://i.postimg.cc/Y2mGTFbK/shen-shi-yue.jpg",
  },
  {
    id: "jixiuyuan",
    name: "季修遠",
    difficulty: "中",
    gender: "男",
    age: 32,
    occupation: "賭場老闆",
    personality: "冷峻，不苟言笑，表情比較嚴肅",
    appearance: "脖子和耳下有燒傷，短髮，戴黑色帽子，身穿西裝和黑色長風衣",
    poster: "https://i.postimg.cc/VkzJSV1r/ji-xiu-yuan.jpg",
  },
  {
    id: "liwanxu",
    name: "李婉序",
    difficulty: "中",
    gender: "女",
    age: 23,
    occupation: "商會採購",
    personality: "目光堅韌，有勇有謀",
    appearance: "劍眉星目，長披肩髮，身穿上衣下裳的民國服飾",
    poster: "https://i.postimg.cc/9QcD4nVr/li-wan-xu.jpg",
  },
  {
    id: "shangyu",
    name: "商羽",
    difficulty: "中",
    gender: "女",
    age: 32,
    occupation: "銀行行長",
    personality: "明豔熱烈",
    appearance:
      "美麗得讓人移不開眼睛，眼角有一顆淚痣，紅唇，短捲髮，穿著修身的黑色帶紅花紋的旗袍",
    poster: "https://i.postimg.cc/CMfB98J9/shang-yu.jpg",
  },
  {
    id: "chenjiashu",
    name: "陳嘉樹",
    difficulty: "低",
    gender: "男",
    age: 26,
    occupation: "貨行老闆",
    personality: "笑面虎，平時總是笑咪咪的，對人溫和好脾氣，但行事果斷狠辣",
    appearance: "短髮，身穿墨藍色馬褂長衫",
    poster: "https://i.postimg.cc/QdjFBysW/chen-jia-shu.jpg",
  },
  {
    id: "lubingbai",
    name: "陸秉白",
    difficulty: "高",
    gender: "男",
    age: 25,
    occupation: "礦場老闆",
    personality: "痞氣，瀟灑不羈，講義氣，喜歡喝酒，和手底下的兄弟們打成一片",
    appearance: "短髮，身穿襯衫長褲，領口敞開",
    hasHiddenBranch: true,
    poster: "https://i.postimg.cc/bY2D4nLV/lu-bing-bai.jpg",
  },
];

export const CHARACTER_MAP: Record<string, CharacterDef> = Object.fromEntries(
  CHARACTERS.map((c) => [c.id, c]),
);

export const PLAYER_COUNT = CHARACTERS.length;

/** 難度對應的顏色，選角卡與主持台共用 */
export const DIFFICULTY_STYLE: Record<Difficulty, string> = {
  低: "border-jade/50 bg-jade/10 text-jade-soft",
  中: "border-gold/50 bg-gold/10 text-gold-soft",
  高: "border-vermilion/50 bg-vermilion/10 text-vermilion-soft",
};

/** 真實陣營。遊戲開始即固定，對玩家保密，只有主持人看得到。 */
export const FACTIONS = ["九爺", "紅姑娘", "隱藏鬼老"] as const;
export type Faction = (typeof FACTIONS)[number];

/**
 * 陸秉白專屬的隱藏分支，由主持人於第三週私下設定，設定後鎖定不可逆。
 * 刻意獨立成一個欄位而不是併進 faction，避免誤觸發或提前曝光。
 */
export const HIDDEN_BRANCHES = ["獨贏", "跟隨主陣營"] as const;
export type HiddenBranch = (typeof HIDDEN_BRANCHES)[number];

/**
 * 線索卡對應表：編號 → 該線索指向的角色。
 *
 * 舉報時系統自動比對：
 *  - 編號不在這 21 張之中 → 「您輸入錯誤」，不留下紀錄也不扣分
 *  - 編號指向的角色 == 被舉報對象 → 舉報成立，扣被舉報人 1 點威望
 *  - 編號指向的角色 != 被舉報對象 → 舉報錯誤，扣舉報人 1 點威望
 */
export const CLUE_CARDS: Record<string, string> = {
  // 周謙
  "0A6": "zhouqian",
  "0B5": "zhouqian",
  "1C3": "zhouqian",
  // 沈識月
  "6A2": "shenshiyue",
  "3C5": "shenshiyue",
  "4BC": "shenshiyue",
  // 陳嘉樹
  "5B6": "chenjiashu",
  "0C5": "chenjiashu",
  "7C3": "chenjiashu",
  // 陸秉白
  "67B": "lubingbai",
  C13: "lubingbai",
  "55A": "lubingbai",
  // 季修遠
  CC5: "jixiuyuan",
  B20: "jixiuyuan",
  B11: "jixiuyuan",
  // 李婉序
  "7C2": "liwanxu",
  "1B6": "liwanxu",
  DD1: "liwanxu",
  // 商羽
  "3BA": "shangyu",
  "5C1": "shangyu",
  "7B7": "shangyu",
};

/** 統一大小寫與空白，玩家手打時不必在意格式 */
export function normalizeClueCode(raw: string): string {
  return (raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

/** 查線索卡指向哪個角色，查無此卡回 null */
export function clueOwner(raw: string): string | null {
  return CLUE_CARDS[normalizeClueCode(raw)] ?? null;
}
