/**
 * 瘋兔子第一幕的撲克牌比大小（陸江遠的賭局）：牌型、算點、勝負。
 *
 * 前後端共用，只放規則，不放任何劇本內容。
 * 牌以兩段字串表示：花色 S♠ H♥ D♦ C♣ ＋ 點數 A、2–10，例如 "SA"、"H10"。
 *
 * 規則（線索卡 03）：只留 A–10 共 40 張；A 算 1 點；
 * 最接近 15 點且沒超過的贏；兩邊都超過或點數相同，起始牌點數小的贏。
 */

export const SUITS = ["S", "H", "D", "C"] as const;
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10"] as const;
export const TARGET = 15;

const SUIT_MARK: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };

/** 新開的一副牌（依花色、點數排好） */
export function freshDeck(): string[] {
  return SUITS.flatMap((s) => RANKS.map((r) => s + r));
}

export function isCard(card: string): boolean {
  return SUITS.includes(card[0] as (typeof SUITS)[number]) && RANKS.includes(card.slice(1) as (typeof RANKS)[number]);
}

export function cardValue(card: string): number {
  const r = card.slice(1);
  return r === "A" ? 1 : Number(r);
}

export function cardLabel(card: string): { suit: string; rank: string; red: boolean } {
  const s = card[0];
  return { suit: SUIT_MARK[s] ?? "?", rank: card.slice(1), red: s === "H" || s === "D" };
}

export function total(cards: string[]): number {
  return cards.reduce((n, c) => n + cardValue(c), 0);
}

export type RoundWinner = "player" | "dealer" | "tie";

/** 兩邊都翻牌後的結果；起始牌是各自的第一張 */
export function roundResult(player: string[], dealer: string[]) {
  const p = total(player);
  const d = total(dealer);
  const pOver = p > TARGET;
  const dOver = d > TARGET;
  let winner: RoundWinner;
  let reason: string;
  if ((pOver && dOver) || p === d) {
    const ps = player[0] ? cardValue(player[0]) : 0;
    const ds = dealer[0] ? cardValue(dealer[0]) : 0;
    winner = ps === ds ? "tie" : ps < ds ? "player" : "dealer";
    reason = pOver && dOver ? "兩邊都超過 15 點，比起始牌（小的贏）" : "點數相同，比起始牌（小的贏）";
  } else if (pOver) {
    winner = "dealer";
    reason = "玩家超過 15 點";
  } else if (dOver) {
    winner = "player";
    reason = "莊家超過 15 點";
  } else {
    winner = p > d ? "player" : "dealer";
    reason = "比較接近 15 點";
  }
  return { playerTotal: p, dealerTotal: d, winner, reason };
}

/** 洗牌（Fisher–Yates）。伺服器端呼叫，玩家無法預測 */
export function shuffled<T>(items: T[], rand: (n: number) => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
