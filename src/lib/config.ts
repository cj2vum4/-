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

export interface StageDef {
  id: string;
  /** 劇本中的階段編號 0–7 */
  index: number;
  label: string;
  hint: string;
  /** 此階段是否開放玩家入場選角 */
  allowJoin: boolean;
  /** 此階段是否有「勢力招募」可供主持人開啟 */
  hasRecruit?: boolean;
}

/** 劇本的 8 個階段。改關卡改這裡，資料庫不用動。 */
export const STAGES: StageDef[] = [
  {
    id: "casting",
    index: 0,
    label: "角色分配／自我介紹",
    hint: "玩家選角並自我介紹，開場後鎖定",
    allowJoin: true,
  },
  {
    id: "expo",
    index: 1,
    label: "拓展會：初始勢力值分配",
    hint: "9 選 3 地點小遊戲，決定開場勢力值差距",
    allowJoin: true,
  },
  {
    id: "act1",
    index: 2,
    label: "第一幕過渡：物品與線索",
    hint: "隨身物品發放、線索卡排序",
    allowJoin: false,
  },
  {
    id: "week1",
    index: 3,
    label: "第一週：競選會長助理",
    hint: "競選 → 投票 → 第 1 輪勢力招募",
    allowJoin: false,
    hasRecruit: true,
  },
  {
    id: "week2",
    index: 4,
    label: "第二週：暗算九爺",
    hint: "暗算機制 → 兇手公投 → 第 2 輪勢力招募",
    allowJoin: false,
    hasRecruit: true,
  },
  {
    id: "week3",
    index: 5,
    label: "第三週：拍賣",
    hint: "拍賣機制 → 第 3 輪（最終）招募 → 陸秉白隱藏分支確認",
    allowJoin: false,
    hasRecruit: true,
  },
  {
    id: "gunfight",
    index: 6,
    label: "第六幕：勢力鬥爭槍戰",
    hint: "血量系統，一次性淘汰賽",
    allowJoin: false,
  },
  {
    id: "final",
    index: 7,
    label: "會長就任結算",
    hint: "依最終勢力值排名產生職位與稱號",
    allowJoin: false,
  },
];

export const STAGE_MAP: Record<string, StageDef> = Object.fromEntries(
  STAGES.map((s) => [s.id, s]),
);

export const DEFAULT_STAGE = STAGES[0].id;

/** 主持台快捷調整幅度 */
export const QUICK_DELTAS = [1, 5, 10, 50, 100];

/** 記錄頁最多回傳幾筆給前端 */
export const LOG_TAIL = 80;

export const APP_NAME = "九爺，我想給您養老";

/** 劇本設定的固定人數，主持人開場時可用來確認是否到齊 */
export const PLAYER_COUNT_HINT = "本劇本為固定 7 人，角色皆可反串";

/** 調查線索的每人次數上限 */
export const INVESTIGATION_LIMIT = 2;
