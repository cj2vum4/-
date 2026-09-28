import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostClue } from "./types";

/**
 * 瘋兔子的線索：content/online/fengtuz/cards.json（27 張線索卡，文字取自 DM 手冊，
 * 圖片在同目錄的 cards/）。由 tools/online/build-fengtuz-content.py 產生，已完全脫離 Supabase。
 *
 * ONLINE_FENGTUZ_MOCK=1 時改用內建的三筆假線索（自動測試用，內容固定才好斷言）。
 */

const MOCK: HostClue[] = [
  { id: "900001", title: "遊戲規則", group: "故事背景", label: "故事背景", audience: "pick", summary: "", body: "調查現場並閱讀規則。", images: [] },
  { id: "900002", title: "病歷記錄", group: "觸發線索", label: "觸發線索", audience: "pick", summary: "", body: "林雲書曾在醫院留下記錄。", images: [] },
  { id: "900003", title: "飛昇儀式", group: "結局", label: "結局", audience: "pick", summary: "", body: "儀式開始後，請簡菲菲說出最後的選擇。", images: [] },
];

const FILE = join(process.cwd(), "content", "online", "fengtuz", "cards.json");

export function fengtuzMockMode(): boolean {
  return process.env.ONLINE_FENGTUZ_MOCK === "1";
}

let cache: HostClue[] | null = null;

export async function loadFengtuzClues(): Promise<{ clues: HostClue[]; note?: string }> {
  if (fengtuzMockMode()) return { clues: MOCK, note: "目前使用測試用假線索（ONLINE_FENGTUZ_MOCK=1）" };
  if (cache) return { clues: cache };
  if (!existsSync(FILE)) {
    return { clues: [], note: "找不到瘋兔子的線索檔 content/online/fengtuz/cards.json。" };
  }
  cache = JSON.parse(readFileSync(FILE, "utf8")) as HostClue[];
  return { clues: cache };
}
