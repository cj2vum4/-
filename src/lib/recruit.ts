/**
 * 勢力招募：彩池、技能卡與抽取次數。
 *
 * 彩池是「有限且剛好發完」的設計：
 *   威望 1–2 名 → 5+3 = 8 次 ×2 人 = 16
 *   威望 3–5 名 → 5+2 = 7 次 ×3 人 = 21
 *   威望 6–7 名 → 5+1 = 6 次 ×2 人 = 12
 *                                總計 49，正好等於彩池張數
 * 所以實作為洗牌後不重複抽取，而不是每次獨立機率。
 */

export const RECRUIT_BASE_DRAWS = 5;
export const RECRUIT_POOL_SIZE = 49;

/** 依威望排名給的額外抽取次數 */
export function rankBonusDraws(rank: number): number {
  if (rank <= 2) return 3;
  if (rank <= 5) return 2;
  return 1;
}

export function drawsForRank(rank: number): number {
  return RECRUIT_BASE_DRAWS + rankBonusDraws(rank);
}

export type SkillEffectKind =
  | "stealPrestige"
  | "stealPower"
  | "giftPrestige"
  | "giftPower";

export interface SkillCardDef {
  id: string;
  name: string;
  description: string;
  kind: SkillEffectKind;
  amount: number;
}

/**
 * 技能卡。每一張都需要選擇一位目標玩家。
 * steal = 從目標身上取；gift = 自己與目標同時增加。
 */
export const SKILL_CARDS: Record<string, SkillCardDef> = {
  w2_steal_prestige: {
    id: "w2_steal_prestige",
    name: "構陷",
    description: "扣除自選玩家 1 點威望",
    kind: "stealPrestige",
    amount: 1,
  },
  w2_steal_power: {
    id: "w2_steal_power",
    name: "暗奪",
    description: "偷取自選玩家 300 點勢力",
    kind: "stealPower",
    amount: 300,
  },
  w2_gift_prestige: {
    id: "w2_gift_prestige",
    name: "結盟",
    description: "自己與自選玩家各增加 1 點威望",
    kind: "giftPrestige",
    amount: 1,
  },
  w3_steal_power: {
    id: "w3_steal_power",
    name: "暗奪",
    description: "偷取自選玩家 300 點勢力",
    kind: "stealPower",
    amount: 300,
  },
  w3_gift_power: {
    id: "w3_gift_power",
    name: "共榮",
    description: "自己與自選玩家各增加 200 點勢力",
    kind: "giftPower",
    amount: 200,
  },
  w3_gift_prestige: {
    id: "w3_gift_prestige",
    name: "同盟",
    description: "自己與自選玩家各增加 2 點威望",
    kind: "giftPrestige",
    amount: 2,
  },
};

interface PoolSpec {
  /** 技能卡張數 */
  skills: Array<{ skillId: string; count: number }>;
  /** 其餘全部是勢力值，範圍含頭尾 */
  powerRange: [number, number];
}

/** 各階段的彩池組成。剩餘張數自動補成勢力值卡，總數固定 49。 */
export const RECRUIT_POOLS: Record<string, PoolSpec> = {
  week2: {
    skills: [
      { skillId: "w2_steal_prestige", count: 2 },
      { skillId: "w2_steal_power", count: 1 },
      { skillId: "w2_gift_prestige", count: 1 },
    ],
    powerRange: [76, 120],
  },
  week3: {
    skills: [
      { skillId: "w3_steal_power", count: 3 },
      { skillId: "w3_gift_power", count: 2 },
      { skillId: "w3_gift_prestige", count: 1 },
    ],
    powerRange: [78, 120],
  },
  // 第六幕與拍賣階段的彩池相同
  gunfight: {
    skills: [
      { skillId: "w3_steal_power", count: 3 },
      { skillId: "w3_gift_power", count: 2 },
      { skillId: "w3_gift_prestige", count: 1 },
    ],
    powerRange: [78, 120],
  },
};

/** 哪些階段一進入就發放抽取次數 */
export const RECRUIT_STAGES = Object.keys(RECRUIT_POOLS);

/**
 * 彩池中的一張牌。
 * 勢力值卡存成 "P:數字"，技能卡存成 "S:卡片id"，方便直接寫進試算表一格。
 */
export type PoolToken = string;

export function powerToken(amount: number): PoolToken {
  return `P:${amount}`;
}
export function skillToken(skillId: string): PoolToken {
  return `S:${skillId}`;
}

export function parseToken(token: PoolToken):
  | { kind: "power"; amount: number }
  | { kind: "skill"; card: SkillCardDef }
  | null {
  if (token.startsWith("P:")) {
    const amount = Number(token.slice(2));
    return Number.isFinite(amount) ? { kind: "power", amount } : null;
  }
  if (token.startsWith("S:")) {
    const card = SKILL_CARDS[token.slice(2)];
    return card ? { kind: "skill", card } : null;
  }
  return null;
}

/** Fisher–Yates；傳入亂數來源方便測試時固定結果 */
function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 依階段建立一副洗好的彩池。
 * 技能卡照設定張數放入，其餘補滿指定範圍內的勢力值卡，總數為 RECRUIT_POOL_SIZE。
 */
export function buildPool(stageId: string, random: () => number = Math.random): PoolToken[] {
  const spec = RECRUIT_POOLS[stageId];
  if (!spec) return [];

  const tokens: PoolToken[] = [];
  for (const { skillId, count } of spec.skills) {
    for (let i = 0; i < count; i++) tokens.push(skillToken(skillId));
  }

  const [min, max] = spec.powerRange;
  const span = max - min + 1;
  while (tokens.length < RECRUIT_POOL_SIZE) {
    tokens.push(powerToken(min + Math.floor(random() * span)));
  }

  return shuffle(tokens, random);
}
