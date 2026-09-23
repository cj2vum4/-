import * as OpenCC from "opencc-js";
import type { HostClue } from "./types";

/**
 * 瘋兔子的線索來源：Supabase 的 cards 表（由 tools/online/ocr_batch.py 從 PDF OCR 匯入）。
 *
 * 以前是玩家的瀏覽器直接去讀這張表，等於整本劇本任何人都能 dump。
 * 現在只有伺服器讀，玩家只拿得到主持人發給他的那幾筆。
 *
 * 環境變數：
 *   SUPABASE_URL          專案網址
 *   SUPABASE_SECRET_KEY   建議用 secret key，然後把 cards 表的匿名讀取關掉
 *   SUPABASE_KEY          沒有 secret key 時的退路（publishable key）
 *   ONLINE_FENGTUZ_MOCK=1 用內建的三筆假線索（本機開發與自動測試用）
 */

const DEFAULT_URL = "https://mcphigetltedeadvuvqf.supabase.co";
// publishable key 本來就是設計給前端公開使用的，原本也寫在 starfishlarp 的前端裡。
// 把 cards 表的匿名讀取關掉之後，這把就讀不到了，屆時要在 Render 設 SUPABASE_SECRET_KEY。
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_Qdg36jjN7W1DUkBGtrzTtQ_bphP6Zg2";

const PAGE_SIZE = 500;
/** 線索內容幾乎不會變，快取久一點，開場時不用每個主持人都重抓一次 */
const CACHE_MS = 30 * 60 * 1000;

interface CardRow {
  id: number;
  filename: string;
  folder: string;
  page_num: number;
  text: string;
}

const MOCK_ROWS: CardRow[] = [
  { id: 900001, filename: "游戏规则", folder: "故事背景", page_num: 1, text: "调查现场并阅读规则。所有玩家都能看到这一条线索。" },
  { id: 900002, filename: "病历记录", folder: "触发线索", page_num: 2, text: "林云书曾在医院留下记录。这段文字用于测试台湾繁体转换。" },
  { id: 900003, filename: "飞升仪式", folder: "结局", page_num: 1, text: "仪式开始后，请简菲菲说出最后的选择。" },
];

const g = globalThis as unknown as {
  __onlineFengtuz?: { at: number; clues: HostClue[] };
  __onlineFengtuzLoading?: Promise<HostClue[]>;
};

let converter: ((s: string) => string) | null = null;
function toTraditional(s: string): string {
  // 資料庫是 OCR 出來的簡體原文，顯示前轉成台灣繁體
  converter ??= OpenCC.Converter({ from: "cn", to: "tw" });
  return converter(s ?? "");
}

export function fengtuzMockMode(): boolean {
  return process.env.ONLINE_FENGTUZ_MOCK === "1";
}

async function fetchRows(): Promise<CardRow[]> {
  if (fengtuzMockMode()) return MOCK_ROWS;

  const base = (process.env.SUPABASE_URL || DEFAULT_URL).replace(/\/$/, "");
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY || DEFAULT_PUBLISHABLE_KEY;
  const rows: CardRow[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url =
      `${base}/rest/v1/cards?select=id,filename,folder,page_num,text&script=eq.fengtuz` +
      `&order=folder.asc,filename.asc,page_num.asc&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new Error(`Supabase 回應 ${res.status}：${(await res.text()).slice(0, 200)}`);
    }
    const page = (await res.json()) as CardRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function toClue(row: CardRow): HostClue {
  const folder = toTraditional(String(row.folder ?? ""));
  const title = toTraditional(String(row.filename ?? ""));
  const pageNum = Number(row.page_num) || 0;
  return {
    id: String(row.id),
    title,
    playerTitle: pageNum ? `${title}（第 ${pageNum} 頁）` : title,
    group: folder || "未分類",
    label: folder || "未分類",
    audience: "pick",
    summary: "",
    body: toTraditional(String(row.text ?? "")) || "（此筆線索沒有 OCR 文字）",
    images: [],
    pageNum,
  };
}

export async function loadFengtuzClues(): Promise<{ clues: HostClue[]; note?: string }> {
  const cached = g.__onlineFengtuz;
  if (cached && Date.now() - cached.at < CACHE_MS) return { clues: cached.clues };

  // 多個請求同時進來時只打一次 Supabase
  g.__onlineFengtuzLoading ??= fetchRows()
    .then((rows) => {
      const clues = rows.map(toClue);
      g.__onlineFengtuz = { at: Date.now(), clues };
      return clues;
    })
    .finally(() => {
      g.__onlineFengtuzLoading = undefined;
    });

  try {
    return { clues: await g.__onlineFengtuzLoading };
  } catch (err) {
    // 抓不到就沿用上一次的內容，總比開場當下線索全消失好
    const message = err instanceof Error ? err.message : String(err);
    console.error("[線上主持] 瘋兔子線索載入失敗", message);
    if (cached) return { clues: cached.clues, note: `線索更新失敗，暫用先前載入的版本（${message}）` };
    return { clues: [], note: `線索載入失敗：${message}` };
  }
}
