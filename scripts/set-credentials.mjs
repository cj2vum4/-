/**
 * 把下載回來的服務帳號 JSON 金鑰裝進專案。
 *
 *   node scripts/set-credentials.mjs ~/Downloads/prandpa-xxxxxxxx.json
 *
 * 它會做三件事：
 *   1. 檢查這確實是一份服務帳號金鑰（有 client_email 與 private_key）
 *   2. 轉成 base64 寫進 .env.local 的 GOOGLE_SERVICE_ACCOUNT_JSON
 *   3. 另外把同一串 base64 寫到 credential.b64.txt，給你貼到 Render
 *
 * ⚠️ 這支程式「不會」把金鑰內容印出來，只會印服務帳號信箱與金鑰 ID 前 8 碼
 *    （那兩個在 Google Cloud Console 上本來就看得到，不是機密）。
 *
 * ⚠️ credential.b64.txt 是機密。貼完 Render 之後請直接刪掉：
 *      rm credential.b64.txt
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const input = process.argv[2];
if (!input) {
  console.error("用法：node scripts/set-credentials.mjs <下載的金鑰 JSON 路徑>");
  console.error("例如：node scripts/set-credentials.mjs ~/Downloads/prandpa-1a2b3c4d.json");
  process.exit(1);
}

const path = resolve(input.replace(/^~/, process.env.HOME ?? "~"));
if (!existsSync(path)) {
  console.error(`找不到檔案：${path}`);
  process.exit(1);
}

let creds;
try {
  creds = JSON.parse(readFileSync(path, "utf8"));
} catch {
  // 刻意不印出檔案內容——解析失敗時把金鑰吐到畫面上是最糟的除錯方式
  console.error("這個檔案不是合法的 JSON。請確認下載的是「JSON」格式的金鑰，不是 P12。");
  process.exit(1);
}

if (typeof creds.client_email !== "string" || typeof creds.private_key !== "string") {
  console.error("這份 JSON 缺少 client_email 或 private_key，不像是服務帳號金鑰。");
  process.exit(1);
}

const base64 = Buffer.from(JSON.stringify(creds), "utf8").toString("base64");

// ---- 寫進 .env.local，保留其他設定 ----
const ENV = resolve(".env.local");
const KEY = "GOOGLE_SERVICE_ACCOUNT_JSON";
let env = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
const line = `${KEY}=${base64}`;

if (new RegExp(`^${KEY}=`, "m").test(env)) {
  env = env.replace(new RegExp(`^${KEY}=.*$`, "m"), line);
} else {
  env = env.trimEnd() + (env.trim() ? "\n" : "") + line + "\n";
}
writeFileSync(ENV, env);

// ---- 另存一份給 Render 貼 ----
writeFileSync(resolve("credential.b64.txt"), base64 + "\n");

const keyId = typeof creds.private_key_id === "string" ? creds.private_key_id.slice(0, 8) : "（無）";
console.log("✅ 已更新 .env.local");
console.log(`   服務帳號：${creds.client_email}`);
console.log(`   金鑰 ID：${keyId}…`);
console.log("");
console.log("下一步：");
console.log("  1. 打開 credential.b64.txt，整份複製");
console.log("  2. 貼到 Render 的 GOOGLE_SERVICE_ACCOUNT_JSON 環境變數");
console.log("  3. 確認網站正常後，刪掉這個檔案：rm credential.b64.txt");
console.log("");
console.log("驗證：npm run check:sheets");
