import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostClue } from "./types";

/**
 * 瘋兔子的線索來源：content/online/fengtuz/cards.json。
 *
 * 以前放在 Supabase 的 cards 表，已經完全脫離 Supabase。這個檔由
 * tools/online/import-fengtuz.mjs 從 OCR 結果（ocr_output.json）或
 * Supabase 匯出的 CSV 轉出來，轉檔時就已經轉好台灣繁體。
 *
 * ONLINE_FENGTUZ_MOCK=1 時改用內建的三筆假線索（本機開發與自動測試用）。
 */

export interface FengtuzCard {
  id: string;
  title: string;
  folder: string;
  pageNum: number;
  text: string;
}

const MOCK: FengtuzCard[] = [
  { id: "900001", title: "遊戲規則", folder: "故事背景", pageNum: 1, text: "調查現場並閱讀規則。所有玩家都能看到這一條線索。" },
  { id: "900002", title: "病歷記錄", folder: "觸發線索", pageNum: 2, text: "林雲書曾在醫院留下記錄。" },
  { id: "900003", title: "飛昇儀式", folder: "結局", pageNum: 1, text: "儀式開始後，請簡菲菲說出最後的選擇。" },
];

const FILE = join(process.cwd(), "content", "online", "fengtuz", "cards.json");

export function fengtuzMockMode(): boolean {
  return process.env.ONLINE_FENGTUZ_MOCK === "1";
}

let cache: HostClue[] | null = null;

function toClue(c: FengtuzCard): HostClue {
  const folder = c.folder || "未分類";
  return {
    id: c.id,
    title: c.title,
    playerTitle: c.pageNum ? `${c.title}（第 ${c.pageNum} 頁）` : c.title,
    group: folder,
    label: folder,
    audience: "pick",
    summary: "",
    body: c.text || "（此筆線索沒有文字）",
    images: [],
    pageNum: c.pageNum,
  };
}

export async function loadFengtuzClues(): Promise<{ clues: HostClue[]; note?: string }> {
  if (fengtuzMockMode()) return { clues: MOCK.map(toClue), note: "目前使用測試用假線索（ONLINE_FENGTUZ_MOCK=1）" };
  if (cache) return { clues: cache };
  if (!existsSync(FILE)) {
    return {
      clues: [],
      note: "尚未匯入瘋兔子的線索。請用 tools/online/import-fengtuz.mjs 把 OCR 結果轉成 content/online/fengtuz/cards.json。",
    };
  }
  const cards = JSON.parse(readFileSync(FILE, "utf8")) as FengtuzCard[];
  cache = cards.map(toClue);
  return { clues: cache };
}
