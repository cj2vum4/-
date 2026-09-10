/**
 * 印出封存分頁的內容，用來確認彙整結果。
 *
 *   node --env-file=.env.local scripts/show-archive.mjs [分頁名稱]
 *
 * 不給分頁名稱就列出所有看起來像封存分頁的名字。
 */
import { google } from "googleapis";
import { readCredentials } from "../src/lib/store/credentials.ts";

const api = google.sheets({
  version: "v4",
  auth: new google.auth.GoogleAuth({
    credentials: readCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  }),
});
const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const ARCHIVE = /^\d{4}-\d{2}-\d{2}(-\d+)?$/;

const meta = await api.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties.title" });
const titles = (meta.data.sheets ?? []).map((s) => s.properties.title);
console.log("所有分頁：", titles.join(" | "));

const target = process.argv[2] ?? titles.find((t) => ARCHIVE.test(t));
if (!target) {
  console.log("\n沒有封存分頁。");
  process.exit(0);
}

const res = await api.spreadsheets.values.get({
  spreadsheetId: id,
  range: `'${target}'!A1:M60`,
});
console.log(`\n=== ${target} ===`);
(res.data.values ?? []).forEach((r, i) =>
  console.log(String(i + 1).padStart(3), (r ?? []).join(" | ")),
);
