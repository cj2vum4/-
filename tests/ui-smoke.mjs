/**
 * 全流程 UI 煙霧測試（需要 playwright，非專案必要相依）
 *   1. 先另開一個終端機跑 npm run build && npm run start
 *   2. node tests/ui-smoke.mjs
 *
 * 會走過：身分選擇 → 主持人開場 → 玩家「無此場次」→ 玩家入場 →
 *         主持人發放資源 → 玩家端即時更新 → 階段切換。
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const SHOTS = process.env.SHOTS ?? null;
const PIN = "8888";

/** 每次跑都用一個沒被用過的場次，測試才能重複執行 */
function randomSessionCode() {
  const y = 2030 + Math.floor(Math.random() * 6);
  const m = 1 + Math.floor(Math.random() * 12);
  const d = 1 + Math.floor(Math.random() * 28);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const CODE = process.env.SESSION_CODE ?? randomSessionCode();
/** 玩家端故意用不補零的斜線寫法，順便驗證日期解析 */
const [cy, cm, cd] = CODE.split("-");
const CODE_LOOSE = `${cy}/${Number(cm)}/${Number(cd)}`;

const shot = async (page, name, opts = {}) =>
  SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png`, ...opts }) : null;

console.log(`使用場次 ${CODE}`);
const browser = await chromium.launch();
const errors = [];
const fail = [];

/** 刻意查詢不存在的場次會回 404，那是正確行為，不算錯誤 */
const EXPECTED_404 = /\/api\/sessions\/2001-01-01$/;

async function newPage(ctx, label) {
  const page = await ctx.newPage();
  page.on("console", (m) => {
    // 瀏覽器會把 HTTP 錯誤也印成 console error，這裡交給 response 監聽判斷
    if (m.type() === "error" && !m.text().includes("Failed to load resource")) {
      errors.push(`[${label}] ${m.text()}`);
    }
  });
  page.on("pageerror", (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && !EXPECTED_404.test(r.url())) {
      errors.push(`[${label}] HTTP ${r.status()} ${r.url()}`);
    }
  });
  return page;
}

function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${actual}${ok ? "" : ` (預期 ${expected})`}`);
  if (!ok) fail.push(label);
}

try {
  // ---- 1. 首頁身分選擇 ----
  // 主持人與玩家都用手機，所以兩邊都用手機尺寸測
  const hostCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const host = await newPage(hostCtx, "host");
  await host.goto(BASE, { waitUntil: "networkidle" });
  await shot(host, "1-landing");
  check("首頁標題", await host.title(), "九爺，我想給您養老");

  // ---- 2. 主持人開場次 ----
  await host.click("text=我是主持人");
  await host.waitForURL("**/host");
  await host.fill('input[placeholder="2026-08-16"]', CODE);
  await host.fill('input[placeholder="例：週六下午場"]', "禮拜四晚場");
  await host.fill('input[type="password"]', PIN);
  await shot(host, "2-host-entry");
  await host.click('button[type="submit"]');
  await host.waitForURL(`**/host/${CODE}`, { timeout: 20000 });
  await host.waitForSelector("text=玩 家", { timeout: 20000 });
  console.log("  PASS  主持人進入主持台");

  // ---- 3. 玩家：先測「無此場次」----
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const player = await newPage(mobile, "player");
  await player.goto(BASE, { waitUntil: "networkidle" });
  await player.click("text=我是玩家");
  await player.waitForURL("**/player");
  await player.fill('input[inputmode="numeric"]', "2001-01-01");
  await player.click('button[type="submit"]');
  await player.waitForSelector("text=無此場次", { timeout: 15000 });
  await shot(player, "3-player-no-session");
  console.log("  PASS  不存在的場次顯示「無此場次」");

  // ---- 4. 玩家用 8/20 這種簡寫入場 ----
  await player.fill('input[inputmode="numeric"]', CODE_LOOSE);
  await player.click('button[type="submit"]');
  await player.waitForURL(`**/player/${CODE}`, { timeout: 20000 });
  await player.waitForSelector('button:has-text("周謙")', { timeout: 20000 });
  await player.fill('label:has-text("你的暱稱") input', "阿謙");
  await player.click('button:has-text("周謙")');
  await shot(player, "4-player-join");
  await player.click('button:has-text("入府")');
  await player.waitForSelector("text=勢力排名", { timeout: 20000 });
  console.log(`  PASS  玩家以「${CODE_LOOSE}」寫法入場成功`);

  for (const name of ["沈識月", "陸秉白"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pg = await newPage(ctx, name);
    await pg.goto(`${BASE}/player/${CODE}`, { waitUntil: "networkidle" });
    await pg.waitForSelector(`button:has-text("${name}")`, { timeout: 20000 });
    await pg.fill('label:has-text("你的暱稱") input', `${name}的暱稱`);
    await pg.click(`button:has-text("${name}")`);
    await pg.click('button:has-text("入府")');
    await pg.waitForSelector("text=勢力排名", { timeout: 20000 });
    await ctx.close();
  }

  // ---- 5. 主持人發放資源 ----
  await host.reload({ waitUntil: "networkidle" });
  await host.waitForSelector("text=周謙", { timeout: 20000 });

  // 威望值是公開數值，全體發放
  await host.click('button:has-text("威望值")');
  await host.fill('input[placeholder^="事由"]', "完成入府考驗");
  await host.click('button:has-text("全選")');
  await host.click('button:has-text("+3")');
  await host.waitForSelector("text=/發放 3 威望/", { timeout: 20000 });

  // 勢力值只有本人看得到，單獨發給周謙
  await host.click('button:has-text("勢力值")');
  await host.click('button:has-text("清除")');
  await host.click('li button:has-text("周謙")');
  await host.fill('input[placeholder^="事由"]', "結盟成功");
  await host.click('button:has-text("+50")');
  await host.waitForSelector("text=/發放 50 勢力/", { timeout: 20000 });
  await shot(host, "5-host-console");
  console.log("  PASS  主持人完成全體與單人發放");

  // ---- 6. 玩家端即時反映（輪詢 3 秒）----
  // 階段 0 不顯示威望，只驗證勢力值同步
  await player.waitForFunction(
    () => /勢力值\s*50/.test(document.body.innerText),
    { timeout: 20000 },
  );
  await shot(player, "6-player-live");
  const text = await player.innerText("body");
  check("玩家看到的勢力值", /勢力值\s*(\d+)/.exec(text)?.[1], "50");
  check("階段 0 不顯示威望", /威望/.test(text), false);

  // ---- 7. 階段切換同步 ----
  await host.click('button:has-text("階段")');
  await host.click('button:has-text("第一週：競選會長助理")');
  await player.waitForFunction(
    () => document.body.innerText.includes("第一週：競選會長助理"),
    { timeout: 20000 },
  );
  await shot(player, "7-player-stage");
  console.log("  PASS  階段切換即時同步到玩家端");

  // ---- 8. 手機版：整頁不得捲動 ----
  // 內容多時由中間區塊自己捲，外層頁面永遠固定，底部導覽列才不會被推走
  async function assertNoPageScroll(page, label, tabLabels) {
    for (const t of tabLabels) {
      await page.click(`nav button:has-text("${t}")`);
      await page.waitForTimeout(350);
      const m = await page.evaluate(() => ({
        pageScroll: document.documentElement.scrollHeight - window.innerHeight,
        bodyScroll: document.body.scrollHeight - window.innerHeight,
        navVisible: (() => {
          const nav = document.querySelector("nav");
          if (!nav) return false;
          const r = nav.getBoundingClientRect();
          return r.bottom <= window.innerHeight + 1 && r.top >= 0;
        })(),
      }));
      check(`${label}「${t}」整頁不捲動`, m.pageScroll <= 1 && m.bodyScroll <= 1, true);
      check(`${label}「${t}」導覽列可見`, m.navVisible, true);
    }
  }

  await assertNoPageScroll(player, "玩家", ["我的", "榜單", "行動", "角色", "動態"]);
  await assertNoPageScroll(host, "主持", ["調配", "階段", "舉報", "設定", "紀錄"]);
  await shot(player, "8-player-tabs");
  await shot(host, "9-host-tabs");

  // ---- 9. 會長就任：主持人發放聘書，玩家端要看得到 ----
  await host.click('nav button:has-text("階段")');
  await host.click('button:has-text("會長就任結算")');
  await host.waitForSelector('button:has-text("發放聘書")', { timeout: 20000 });

  // 三個人現在勢力值都不同（周謙 50、其餘 0），但同分會擋下發放，先拉開差距
  await host.click('nav button:has-text("調配")');
  await host.click('button:has-text("勢力值")');
  await host.click('button:has-text("清除")');
  await host.click('li button:has-text("沈識月")');
  await host.click('button:has-text("+20")');
  await host.waitForSelector("text=/發放 20 勢力/", { timeout: 20000 });

  await host.click('nav button:has-text("階段")');
  host.once("dialog", (d) => d.accept());
  await host.click('button:has-text("發放聘書")');
  await host.waitForSelector("text=聘書已發放", { timeout: 20000 });
  check("主持人發放聘書", true, true);

  // 周謙 50 分是第一名，聘書上要有稱號與入場時填的暱稱
  await player.click('nav button:has-text("我的")');
  await player.waitForFunction(
    () => document.body.innerText.includes("聘 書"),
    { timeout: 20000 },
  );
  const certText = await player.innerText("body");
  check("聘書出現在玩家端", /聘 書/.test(certText), true);
  check("聘書署名用入場暱稱", /阿謙/.test(certText), true);
  check("聘書職位為會長", /會長/.test(certText), true);
  check("聘書稱號正確", /南洋最強贏麻了/.test(certText), true);
  await shot(player, "10-player-certificate");

  // 聘書是頁面裡最高的元件，要確認它沒把導覽列擠出畫面
  await assertNoPageScroll(player, "玩家（聘書後）", ["我的"]);
} finally {
  await browser.close();
}

if (errors.length) {
  console.log("\n瀏覽器主控台錯誤：");
  errors.forEach((e) => console.log("  " + e));
}
if (fail.length || errors.length) {
  console.log(`\n測試未通過（${fail.length} 個斷言失敗、${errors.length} 個主控台錯誤）`);
  process.exit(1);
}
console.log("\nUI 全流程通過，且沒有任何瀏覽器主控台錯誤");
