/**
 * 檢查前端 bundle 有沒有洩漏對玩家保密的資料。
 *
 *   npm run build:only && node scripts/check-leaks.mjs
 *
 * 為什麼需要這個：`src/lib/characters.ts` 會被玩家端的 client component import，
 * 放進去的東西會原封不動打包進瀏覽器可下載的 JS。真實陣營曾經因此外洩過——
 * 玩家打開 devtools 就能看到全場陣營，陣營博弈直接破功。
 *
 * 這裡檢查兩件事：
 *   1. 角色 → 真實陣營的對應（`faction:"九爺"` 這種形式）
 *   2. 21 張線索卡的編號（洩漏就等於公布答案，舉報必中）
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CHUNK_DIR = ".next/static/chunks";

/** 陣營名稱本身不是機密（玩家在遊戲中就會知道），機密的是「誰屬於哪一邊」 */
const FACTION_MAPPING = ["九爺", "紅姑娘", "隱藏鬼老"].map((f) => `faction:"${f}"`);

const CLUE_CODES = [
  "0A6", "0B5", "1C3", "6A2", "3C5", "4BC", "5B6", "0C5", "7C3",
  "67B", "C13", "55A", "CC5", "B20", "B11", "7C2", "1B6", "DD1",
  "3BA", "5C1", "7B7",
];

let files;
try {
  files = readdirSync(CHUNK_DIR).filter((f) => f.endsWith(".js"));
} catch {
  console.error(`找不到 ${CHUNK_DIR}，請先跑 npm run build:only`);
  process.exit(1);
}

const findings = [];

for (const name of files) {
  const path = join(CHUNK_DIR, name);
  const text = readFileSync(path, "utf8");
  // 只檢查玩家端會載入的 chunk：主持人本來就看得到陣營
  const isPlayerChunk = text.includes("入府");
  if (!isPlayerChunk) continue;

  for (const needle of FACTION_MAPPING) {
    if (text.includes(needle)) findings.push(`${name}：角色陣營對應 ${needle}`);
  }
  // 線索卡編號短又常見，用帶引號的形式比對，降低誤判
  for (const code of CLUE_CODES) {
    if (text.includes(`"${code}"`)) findings.push(`${name}：線索卡編號 "${code}"`);
  }
}

if (findings.length > 0) {
  console.error("❌ 玩家端 bundle 洩漏機密資料：");
  findings.forEach((f) => console.error("   " + f));
  console.error("\n機密資料請放到只有伺服器端 import 的模組，例如 src/lib/script-factions.ts。");
  process.exit(1);
}

console.log(`✅ 玩家端 bundle 沒有洩漏陣營對應與線索卡答案（檢查了 ${files.length} 個 chunk）`);
