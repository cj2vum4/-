/**
 * 把「場次總表」升級到最新的欄位配置。
 *
 *   node --env-file=.env.local scripts/migrate-sessions.mjs          # 只預覽
 *   node --env-file=.env.local scripts/migrate-sessions.mjs --apply  # 實際寫入
 *
 * 舊格式（8 欄）：場次代碼 場次名稱 狀態 目前階段 招募開放 主持通行碼 建立時間 更新時間
 * 新格式（10 欄）：… 招募開放 彩池階段 彩池剩餘 主持通行碼 建立時間 更新時間
 *
 * 沒有這個遷移的話，改版前建立的場次會讀到錯位的主持通行碼，主持人進不去。
 */
import { google } from "googleapis";

const APPLY = process.argv.includes("--apply");
const TAB = "場次總表";
const HEADERS = [
  "場次代碼",
  "場次名稱",
  "狀態",
  "目前階段",
  "招募開放",
  "彩池階段",
  "彩池剩餘",
  "主持通行碼",
  "建立時間",
  "更新時間",
];
const ISO = /^\d{4}-\d{2}-\d{2}T/;

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

const res = await api.spreadsheets.values.get({
  spreadsheetId: id,
  range: `'${TAB}'!A1:J500`,
  valueRenderOption: "UNFORMATTED_VALUE",
});
const rows = res.data.values ?? [];
if (rows.length === 0) {
  console.log("場次總表是空的，不需要遷移。");
  process.exit(0);
}

const cell = (r, i) => String(r[i] ?? "");
const out = [HEADERS];
let migrated = 0;

for (const row of rows.slice(1)) {
  if (!cell(row, 0)) continue;
  // 舊格式的第 7 欄是建立時間（ISO 時間戳）；新格式那一欄是彩池
  const legacy = ISO.test(cell(row, 6));
  if (legacy) {
    migrated++;
    out.push([
      cell(row, 0), cell(row, 1), cell(row, 2), cell(row, 3), cell(row, 4),
      "", "",                       // 彩池階段、彩池剩餘：舊場次沒有
      cell(row, 5),                 // 主持通行碼
      cell(row, 6), cell(row, 7),   // 建立時間、更新時間
    ]);
    console.log(`  遷移 ${cell(row, 0)}（主持通行碼 ${cell(row, 5) ? "已保留" : "空白"}）`);
  } else {
    out.push(HEADERS.map((_, i) => cell(row, i)));
  }
}

const headerStale = HEADERS.some((h, i) => cell(rows[0], i) !== h);
console.log(`\n表頭：${headerStale ? "舊版，需更新" : "已是最新"}`);
console.log(`資料列：${out.length - 1} 筆，其中 ${migrated} 筆需要遷移`);

if (!APPLY) {
  console.log("\n這是預覽。確認無誤後加上 --apply 實際寫入。");
  process.exit(0);
}
if (!headerStale && migrated === 0) {
  console.log("已經是最新格式，不需要寫入。");
  process.exit(0);
}

await api.spreadsheets.values.update({
  spreadsheetId: id,
  range: `'${TAB}'!A1:J${out.length}`,
  valueInputOption: "RAW",
  requestBody: { values: out },
});
console.log(`\n✅ 已更新表頭與 ${migrated} 筆場次。`);
