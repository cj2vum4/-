import type { ResourceDef, ResourceKey } from "./types";

/**
 * 三種數值。可見性規則不同，是本系統最容易出錯的地方：
 *
 *  - 勢力值：僅本人看得到具體數字，其他人只看得到名次（不含數值）
 *  - 威望值：完全公開，有公開排行榜
 *  - 血量　：本人與主持人可見，僅用於第六幕槍戰
 */
export const RESOURCES: ResourceDef[] = [
  {
    key: "power",
    label: "勢力值",
    short: "勢力",
    accent: "--jade",
    visibility: "self",
    description: "核心勝負指標，決定最終誰當選會長",
  },
  {
    key: "prestige",
    label: "威望值",
    short: "威望",
    accent: "--gold",
    visibility: "public",
    description: "決定每週額外抽取勢力值的次數",
  },
  {
    key: "hp",
    label: "血量",
    short: "血量",
    accent: "--vermilion",
    visibility: "self",
    description: "僅用於第六幕槍戰的淘汰判定",
  },
];

export const RESOURCE_MAP: Record<ResourceKey, ResourceDef> = Object.fromEntries(
  RESOURCES.map((r) => [r.key, r]),
) as Record<ResourceKey, ResourceDef>;

/** 主持台預設會顯示的兩種數值（血量只在槍戰階段才需要頻繁調整） */
export const PRIMARY_RESOURCES: ResourceKey[] = ["power", "prestige"];

/**
 * 每筆數值變動都要標註來源，方便除錯、爭議追溯與最終結算稽核。
 */
export const LEDGER_SOURCES = [
  "主持人手動發放",
  "地點小遊戲",
  "隨身物品組合",
  "投票獎勵",
  "舉報懲罰",
  "技能卡效果",
  "拍賣扣款",
  "拍賣結算",
  "玩家間轉贈",
  "勢力招募抽取",
  "槍戰結算",
  "系統修正",
] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];

export const DEFAULT_LEDGER_SOURCE: LedgerSource = "主持人手動發放";

export interface StageQuickPreset {
  label: string;
  delta: number;
}

export interface StageDef {
  id: string;
  /** 顯示用的階段序號 */
  index: number;
  label: string;
  hint: string;
  /** 此階段是否開放玩家入場選角 */
  allowJoin: boolean;
  /** 此階段是否有「勢力招募」可供主持人開啟 */
  hasRecruit?: boolean;
  /** 此階段是否開放玩家舉報與調查 */
  hasReport?: boolean;
  /** 此階段是否顯示拓展會的地點核選 */
  hasLocations?: boolean;
  /** 進入此階段時，調配面板預設要調的數值 */
  defaultResource: ResourceKey;
  /** 進入此階段時，調配面板預設的來源類型 */
  defaultSource: LedgerSource;
  /** 此階段常用的調整幅度，取代通用的快捷按鈕 */
  quickDeltas: number[];
  /**
   * 其他玩家的勢力值可見程度。
   * value = 看得到確切數字；hidden = 完全看不到，連名次都沒有。
   * 自己的勢力值永遠看得到。
   */
  peerPower: "value" | "hidden";
  /** 威望值相關資訊是否出現在玩家端（含自己的）。第一週前完全不提威望。 */
  showPrestige: boolean;
  /** 主持人的快捷核選項目 */
  presets?: StagePreset[];
  /** 進入此階段時是否自動開啟招募（不需主持人手動開） */
  autoRecruit?: boolean;
  /** 進入此階段時是否依威望排名發放抽取次數 */
  grantsDraws?: boolean;
}

/**
 * 劇本的遊戲階段。改關卡改這裡，資料庫不用動。
 *
 * 每個階段都帶著自己的調配預設（要調哪個數值、來源類型、常用幅度），
 * 主持人切到該階段時面板會自動跟著換，不必每次手動選。
 */
export const STAGES: StageDef[] = [
  {
    id: "casting",
    index: 0,
    label: "角色分配／自我介紹",
    hint: "玩家選角並自我介紹，開場後鎖定",
    allowJoin: true,
    defaultResource: "power",
    defaultSource: "主持人手動發放",
    quickDeltas: [1, 5, 10],
    peerPower: "value",
    showPrestige: false,
  },
  {
    id: "expo",
    index: 1,
    label: "拓展會：初始勢力值分配",
    hint: "9 選 3 地點小遊戲，決定開場勢力值差距",
    allowJoin: true,
    hasLocations: true,
    defaultResource: "power",
    defaultSource: "地點小遊戲",
    quickDeltas: [10, 20, 50, 100],
    peerPower: "value",
    showPrestige: false,
    presets: [
      { id: "fulu", label: "福祿早茶鋪", manual: true },
      { id: "zhonghua", label: "中華養生堂", manual: true },
      { id: "hutou", label: "虎頭幫", manual: true },
      { id: "jinyin", label: "金銀賭坊", manual: true },
      { id: "baichun", label: "百春武館", manual: true },
      { id: "fenghua", label: "風花歌舞廳", manual: true },
      { id: "jiale", label: "家樂百貨行", manual: true },
      { id: "nanpai", label: "南派美食街", manual: true },
      { id: "yongle", label: "永樂錢莊", manual: true },
    ],
  },
  {
    id: "week1",
    index: 2,
    label: "第一週：競選會長助理",
    hint: "競選 → 投票 → 第 1 輪勢力招募",
    allowJoin: false,
    hasRecruit: true,
    hasReport: true,
    defaultResource: "prestige",
    defaultSource: "投票獎勵",
    quickDeltas: [1, 2, 3, 5],
    peerPower: "hidden",
    showPrestige: true,
    // 第一週起招募系統自動開啟，但這一階段還不發抽取次數
    autoRecruit: true,
    presets: [
      { id: "treasure", label: "開啟九爺金庫的寶箱", power: 800 },
      { id: "key", label: "花紋金鑰匙", power: 500 },
      { id: "jade", label: "廟街隱藏麒麟玉珮", power: 500 },
      { id: "assistant", label: "當選會長助理", power: 200 },
    ],
  },
  {
    id: "week2",
    index: 3,
    label: "第二週：暗算九爺",
    hint: "暗算機制 → 兇手公投 → 第 2 輪勢力招募",
    allowJoin: false,
    hasRecruit: true,
    hasReport: true,
    defaultResource: "prestige",
    defaultSource: "投票獎勵",
    quickDeltas: [1, 2, 3, 5],
    peerPower: "hidden",
    showPrestige: true,
    autoRecruit: true,
    grantsDraws: true,
    presets: [{ id: "frame", label: "陷害九爺", power: -300, prestige: -2 }],
  },
  {
    id: "week3",
    index: 4,
    label: "第三週：拍賣",
    hint: "拍賣機制 → 第 3 輪（最終）招募 → 陸秉白隱藏分支確認",
    allowJoin: false,
    hasRecruit: true,
    hasReport: true,
    defaultResource: "power",
    defaultSource: "拍賣扣款",
    quickDeltas: [100, 200, 300, 500],
    peerPower: "hidden",
    showPrestige: true,
    autoRecruit: true,
    grantsDraws: true,
    presets: [
      { id: "nanshan", label: "南山武館", power: 2000 },
      { id: "broadway", label: "百老匯音樂廳", power: 1500 },
      { id: "nanya", label: "南亞種植園", power: 2500 },
      { id: "doujin", label: "斗金典當行", power: 2000 },
      { id: "huamanlou", label: "南洋花滿樓", manual: true },
    ],
  },
  {
    id: "gunfight",
    index: 5,
    label: "第六幕：勢力鬥爭槍戰",
    hint: "血量系統，一次性淘汰賽",
    allowJoin: false,
    defaultResource: "hp",
    defaultSource: "槍戰結算",
    quickDeltas: [1, 2, 3],
    peerPower: "hidden",
    showPrestige: true,
    autoRecruit: true,
    grantsDraws: true,
    presets: [
      { id: "out1", label: "首輪被淘汰", power: 800 },
      { id: "out2", label: "第二輪被淘汰", power: 1000 },
      { id: "out3", label: "第三輪被淘汰", power: 1200 },
      { id: "survive", label: "存活", power: 1400 },
    ],
  },
  {
    id: "final",
    index: 6,
    label: "會長就任結算",
    hint: "依最終勢力值排名產生職位與稱號",
    allowJoin: false,
    defaultResource: "power",
    defaultSource: "系統修正",
    quickDeltas: [10, 50, 100],
    peerPower: "hidden",
    showPrestige: true,
  },
];

export const STAGE_MAP: Record<string, StageDef> = Object.fromEntries(
  STAGES.map((s) => [s.id, s]),
);

export const DEFAULT_STAGE = STAGES[0].id;

/** 沒有階段預設時的通用快捷幅度 */
export const QUICK_DELTAS = [1, 5, 10, 50, 100];

/**
 * 主持人的階段快捷核選項目。
 *
 * 勾選後會把名稱寫進紀錄事由；有設定數值的會自動加總，
 * 沒設定（manual）的由主持人自行輸入金額。
 * 一個項目可以同時影響勢力值與威望值（例如「陷害九爺」）。
 */
export interface StagePreset {
  id: string;
  label: string;
  power?: number;
  prestige?: number;
  /** 數值不固定，需要主持人現場決定 */
  manual?: boolean;
}

export const EXPO_PICK_COUNT = 3;

/** 記錄頁最多回傳幾筆給前端 */
export const LOG_TAIL = 80;

export const APP_NAME = "九爺，我想給您養老";

/** 劇本設定的固定人數，主持人開場時可用來確認是否到齊 */
export const PLAYER_COUNT_HINT = "本劇本為固定 7 人，角色皆可反串";

/** 每位玩家的威望值初始值 */
export const INITIAL_PRESTIGE = 10;


