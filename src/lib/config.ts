import type { ResourceDef, ResourceKey } from "./types";

/** 遊戲中的資源種類。要新增第三種資源，在這裡加一筆即可。 */
export const RESOURCES: ResourceDef[] = [
  { key: "prestige", label: "威望值", short: "威望", accent: "--gold" },
  { key: "influence", label: "勢力值", short: "勢力", accent: "--jade" },
];

export const RESOURCE_MAP: Record<ResourceKey, ResourceDef> = Object.fromEntries(
  RESOURCES.map((r) => [r.key, r]),
) as Record<ResourceKey, ResourceDef>;

export interface StageDef {
  id: string;
  label: string;
  hint: string;
  /** 此階段是否開放新玩家加入 */
  allowJoin: boolean;
}

/**
 * 遊戲階段。主持人可前進／後退／直接跳轉。
 * 之後要擴充關卡，改這個陣列即可，資料庫不需要動。
 */
export const STAGES: StageDef[] = [
  { id: "checkin", label: "入府報到", hint: "玩家陸續加入，尚未開始", allowJoin: true },
  { id: "opening", label: "開場宣講", hint: "說明規則與身分", allowJoin: true },
  { id: "round1", label: "第一回合", hint: "初探九爺府", allowJoin: false },
  { id: "round2", label: "第二回合", hint: "各方角力", allowJoin: false },
  { id: "round3", label: "第三回合", hint: "決戰時刻", allowJoin: false },
  { id: "settle", label: "結算", hint: "統計威望與勢力", allowJoin: false },
  { id: "ended", label: "已結束", hint: "本場次已封存", allowJoin: false },
];

export const STAGE_MAP: Record<string, StageDef> = Object.fromEntries(
  STAGES.map((s) => [s.id, s]),
);

export const DEFAULT_STAGE = STAGES[0].id;

export const APP_NAME = "九爺，我想給您養老";

/** 主持台預設的快捷調整幅度 */
export const QUICK_DELTAS = [1, 3, 5, 10, 20];

/** 記錄頁最多回傳幾筆給前端 */
export const LOG_TAIL = 60;
