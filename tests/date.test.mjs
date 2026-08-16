/**
 * 日期解析測試：node --experimental-strip-types tests/date.test.mjs
 * 玩家與主持人輸入的日期寫法很雜，這支確保各種寫法都能對上同一個場次代碼。
 */
import { normalizeSessionCode } from "../src/lib/date.ts";

const year = new Date().getFullYear();
const cases = [
  ["2026-08-16", "2026-08-16"],
  ["2026/8/16", "2026-08-16"],
  ["2026.8.16", "2026-08-16"],
  ["2026年8月16日", "2026-08-16"],
  ["20260816", "2026-08-16"],
  ["260816", "2026-08-16"],
  [" 2026-08-16 ", "2026-08-16"],
  ["8/16", `${year}-08-16`],
  ["0816", `${year}-08-16`],
  ["816", `${year}-08-16`],
  ["2026-02-30", null],
  ["2026-13-01", null],
  ["", null],
  ["abc", null],
  ["12345", null],
];

let failed = 0;
for (const [input, want] of cases) {
  const got = normalizeSessionCode(input);
  if (got !== want) {
    failed++;
    console.error(`FAIL  ${JSON.stringify(input)} -> ${got}  (預期 ${want})`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} 個案例失敗`);
  process.exit(1);
}
console.log(`日期解析測試通過（${cases.length} 個案例）`);
