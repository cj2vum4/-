/**
 * 把瘋兔子的線索匯入成 content/online/fengtuz/cards.json（伺服器讀的就是這個檔）。
 *
 *   node tools/online/import-fengtuz.mjs <來源檔>
 *
 * 來源檔可以是：
 *   - ocr_batch.py 產生的 ocr_output.json（OCR 時加 --no-upload，不再上傳 Supabase）
 *   - Supabase 的 cards 表匯出的 CSV（Table Editor → cards → Export → CSV）
 *
 * 會做的事：只留 script = fengtuz 的資料、依資料夾／檔名／頁碼排序、
 * 簡體轉台灣繁體、檔名去掉副檔名當標題。重跑會整份覆蓋。
 *
 * 注意：線索編號是場次紀錄對應「發了哪張」的依據。場次進行中不要重新匯入，
 * 否則編號可能對不上。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import * as OpenCC from "opencc-js";

const src = process.argv[2];
if (!src) {
  console.error("用法：node tools/online/import-fengtuz.mjs <ocr_output.json 或 cards.csv>");
  process.exit(1);
}

const toTw = OpenCC.Converter({ from: "cn", to: "tw" });
const raw = readFileSync(src, "utf8").replace(/^﻿/, "");

/** 支援欄位內含逗號、換行、雙引號的標準 CSV */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [header, ...body] = rows.filter((r) => r.some((v) => v !== ""));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}

const records = extname(src).toLowerCase() === ".csv" ? parseCsv(raw) : JSON.parse(raw);
const rows = records
  .filter((r) => !r.script || r.script === "fengtuz")
  .map((r) => ({
    id: r.id ? String(r.id) : "",
    filename: String(r.filename ?? ""),
    folder: String(r.folder ?? ""),
    pageNum: Number(r.page_num ?? r.pageNum ?? 0) || 0,
    text: String(r.text ?? ""),
  }))
  .sort(
    (a, b) =>
      a.folder.localeCompare(b.folder) || a.filename.localeCompare(b.filename) || a.pageNum - b.pageNum,
  );

// OCR 輸出沒有編號，依排序給一個；Supabase 匯出的沿用原本的 id
const cards = rows.map((r, i) => ({
  id: r.id || String(i + 1),
  title: toTw(r.filename.replace(/\.[a-z0-9]+$/i, "")),
  folder: toTw(r.folder.replace(/\\/g, "/")),
  pageNum: r.pageNum,
  text: toTw(r.text).trim(),
}));

const out = join(process.cwd(), "content", "online", "fengtuz", "cards.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(cards, null, 1) + "\n");

const folders = [...new Set(cards.map((c) => c.folder || "未分類"))];
console.log(`✓ 匯入 ${cards.length} 筆線索 → ${out}`);
console.log(`  分類：${folders.join("、")}`);
