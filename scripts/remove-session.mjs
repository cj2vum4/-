/**
 * 刪除指定場次：移除該場次的所有分頁，並從「場次總表」刪掉對應那一列。
 *
 *   node --env-file=.env.local scripts/remove-session.mjs 2026-08-16 [更多場次…]
 *
 * 只會動到你明確指定的場次，不接受萬用字元，也不會碰其他分頁。
 * 刪除無法復原，執行前會先列出將要刪除的內容。
 */
import { google } from "googleapis";

const codes = process.argv.slice(2);
if (codes.length === 0) {
  console.error("用法：node --env-file=.env.local scripts/remove-session.mjs <場次代碼> [場次代碼…]");
  console.error("例如：node --env-file=.env.local scripts/remove-session.mjs 2026-08-16");
  process.exit(1);
}

// 場次代碼是當天日期；同一天第二場會加序號，例如 2026-09-11-2
const bad = codes.filter((c) => !/^\d{4}-\d{2}-\d{2}(-\d{1,2})?$/.test(c));
if (bad.length) {
  console.error(`場次代碼格式須為 YYYY-MM-DD 或 YYYY-MM-DD-2：${bad.join("、")}`);
  process.exit(1);
}

const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if (!id || !raw) {
  console.error("缺少 GOOGLE_SHEETS_SPREADSHEET_ID 或 GOOGLE_SERVICE_ACCOUNT_JSON");
  process.exit(1);
}
const creds = JSON.parse(raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
const api = google.sheets({
  version: "v4",
  auth: new google.auth.GoogleAuth({ credentials: creds, scopes: ["https://www.googleapis.com/auth/spreadsheets"] }),
});

const meta = await api.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties(title,sheetId)" });
const byTitle = new Map(meta.data.sheets.map((s) => [s.properties.title, s.properties.sheetId]));

const targets = [];
for (const code of codes) {
  // 三個工作分頁，加上封存後的彙整分頁（名稱就是場次代碼本身）
  for (const title of [`${code}_玩家`, `${code}_紀錄`, `${code}_舉報`, code]) {
    if (byTitle.has(title)) targets.push({ title, sheetId: byTitle.get(title) });
  }
}

// 找出「場次總表」中要刪掉的列
const SESSIONS = "場次總表";
let rowDeletes = [];
if (byTitle.has(SESSIONS)) {
  const res = await api.spreadsheets.values.get({ spreadsheetId: id, range: `'${SESSIONS}'!A1:A500` });
  const col = (res.data.values ?? []).map((r) => String(r[0] ?? ""));
  // 由下往上刪，才不會因為列往上移而刪錯
  rowDeletes = col
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => codes.includes(v))
    .map(({ v, i }) => ({ code: v, index: i }))
    .reverse();
}

if (targets.length === 0 && rowDeletes.length === 0) {
  console.log("沒有找到符合的場次，未做任何變更。");
  process.exit(0);
}

console.log("將刪除：");
targets.forEach((t) => console.log(`  • 分頁 ${t.title}`));
rowDeletes.forEach((r) => console.log(`  • 場次總表第 ${r.index + 1} 列（${r.code}）`));

const requests = [
  ...targets.map((t) => ({ deleteSheet: { sheetId: t.sheetId } })),
  ...rowDeletes.map((r) => ({
    deleteDimension: {
      range: { sheetId: byTitle.get(SESSIONS), dimension: "ROWS", startIndex: r.index, endIndex: r.index + 1 },
    },
  })),
];

await api.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests } });
console.log(`\n✅ 已刪除 ${targets.length} 個分頁、${rowDeletes.length} 筆場次總表紀錄。`);
