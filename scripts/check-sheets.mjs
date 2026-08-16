/**
 * Google Sheet 連線診斷
 *   node --env-file=.env.local scripts/check-sheets.mjs
 *
 * 會依序檢查：環境變數 → 服務帳號認證 → 試算表存取權 → 寫入權限，
 * 並針對常見錯誤（沒分享、ID 打錯、金鑰失效）給出對應的處理方式。
 */
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

function die(msg, hint) {
  console.error(`\n❌ ${msg}`);
  if (hint) console.error(`\n   ${hint}`);
  process.exit(1);
}

// 1. 環境變數
if (!id) die("找不到 GOOGLE_SHEETS_SPREADSHEET_ID", "請確認 .env.local 已建立，且用 --env-file=.env.local 執行。");

const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
let creds;
if (raw) {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  try {
    creds = JSON.parse(text);
  } catch {
    die("GOOGLE_SERVICE_ACCOUNT_JSON 不是合法的 JSON（也不是 base64 過的 JSON）");
  }
} else if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
  creds = {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  };
} else {
  die("找不到服務帳號憑證", "請設定 GOOGLE_SERVICE_ACCOUNT_JSON，或 EMAIL + PRIVATE_KEY。");
}

console.log("① 環境變數      ✅");
console.log(`   試算表 ID     ${id}`);
console.log(`   服務帳號      ${creds.client_email}`);

// 2. 認證
const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: SCOPES });
const api = google.sheets({ version: "v4", auth });

let client;
try {
  client = await auth.getClient();
  await client.getAccessToken();
  console.log("② 服務帳號認證  ✅");
} catch (err) {
  die(`認證失敗：${err.message}`, "金鑰可能已被撤銷或損毀，請到 Google Cloud Console 重新產生一組 JSON 金鑰。");
}

// 3. 讀取試算表
let meta;
try {
  const res = await api.spreadsheets.get({
    spreadsheetId: id,
    fields: "properties.title,properties.timeZone,sheets.properties(title,gridProperties)",
  });
  meta = res.data;
  console.log("③ 讀取試算表    ✅");
} catch (err) {
  const code = err?.code ?? err?.response?.status;
  if (code === 403) {
    die(
      "沒有存取權限（HTTP 403）",
      `請到試算表按「共用」，把 ${creds.client_email} 加進去並給「編輯者」權限。`,
    );
  }
  if (code === 404) {
    die("找不到這份試算表（HTTP 404）", "請確認 GOOGLE_SHEETS_SPREADSHEET_ID 是網址中 /d/ 後面那一段。");
  }
  die(`讀取失敗：${err.message}`);
}

console.log(`   試算表名稱    ${meta.properties?.title}`);
console.log(`   時區          ${meta.properties?.timeZone}`);
const tabs = (meta.sheets ?? []).map((s) => s.properties?.title);
console.log(`   現有分頁(${tabs.length})  ${tabs.length ? tabs.join("、") : "（空白試算表）"}`);

// 4. 寫入權限（建一個暫時分頁再刪掉，不動到既有資料）
const probe = `__連線測試_${Date.now()}`;
try {
  const add = await api.spreadsheets.batchUpdate({
    spreadsheetId: id,
    requestBody: { requests: [{ addSheet: { properties: { title: probe } } }] },
  });
  const sheetId = add.data.replies?.[0]?.addSheet?.properties?.sheetId;

  await api.spreadsheets.values.update({
    spreadsheetId: id,
    range: `'${probe}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [["連線測試成功", new Date().toISOString()]] },
  });

  await api.spreadsheets.batchUpdate({
    spreadsheetId: id,
    requestBody: { requests: [{ deleteSheet: { sheetId } }] },
  });
  console.log("④ 寫入權限      ✅（已建立測試分頁、寫入、並刪除，未動到既有資料）");
} catch (err) {
  const code = err?.code ?? err?.response?.status;
  if (code === 403) {
    die("只有讀取權限，不能寫入（HTTP 403）", `請把 ${creds.client_email} 的權限從「檢視者」改成「編輯者」。`);
  }
  die(`寫入測試失敗：${err.message}`);
}

console.log("\n✅ 全部通過，可以正式使用 Google Sheet 當資料庫了。");
