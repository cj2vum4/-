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
/** 每次跑都用沒被用過的密碼，測試才能重複執行 */
const PASSWORD = `ui-${Math.random().toString(36).slice(2, 10)}`;
/** 場次代碼由伺服器產生（當天日期），開場之後才知道 */
let CODE = "";

const shot = async (page, name, opts = {}) =>
  SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png`, ...opts }) : null;

console.log(`使用開場密碼 ${PASSWORD}`);
const browser = await chromium.launch();
const errors = [];
const fail = [];

/** 刻意查詢不存在的場次會回 404，那是正確行為，不算錯誤 */
/**
 * 這幾支端點在測試裡會「故意」失敗，那是被驗證的行為本身，不算錯誤：
 *   lookup  → 故意查一組不存在的密碼，要回「無此場次」
 *   rejoin  → 故意打錯暱稱，要被擋下來
 */
const EXPECTED_FAILURES = /\/api\/sessions\/(lookup|[^/]+\/rejoin)$/;

/**
 * 有些步驟是「故意觸發失敗」來驗證擋得住（例如票沒投完不能換階段）。
 * 那種 4xx 不是錯誤，但也不該把整條端點永久加進白名單——
 * 真的壞掉時就看不出來了。所以只在那一小段期間開啟這個旗標。
 */
let expectingFailure = false;
async function expectFailure(fn) {
  expectingFailure = true;
  try {
    await fn();
  } finally {
    expectingFailure = false;
  }
}

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
    if (r.status() >= 400 && !expectingFailure && !EXPECTED_FAILURES.test(r.url())) {
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
  await host.fill('input[placeholder="至少 4 個字"]', PASSWORD);
  await host.fill('input[placeholder="例：週六下午場"]', "禮拜四晚場");
  await shot(host, "2-host-entry");
  await host.click('button[type="submit"]');
  await host.waitForURL(/\/host\/\d{4}-\d{2}-\d{2}/, { timeout: 20000 });
  await host.waitForSelector("text=玩 家", { timeout: 20000 });
  CODE = new URL(host.url()).pathname.split("/").pop();
  console.log(`  PASS  主持人進入主持台（場次 ${CODE}）`);

  // ---- 3. 玩家：先測「無此場次」----
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const player = await newPage(mobile, "player");
  await player.goto(BASE, { waitUntil: "networkidle" });
  await player.click("text=我是玩家");
  await player.waitForURL("**/player");
  await player.fill('input[placeholder="主持人會告訴你"]', "沒有這組密碼");
  await player.click('button[type="submit"]');
  await player.waitForSelector("text=無此場次", { timeout: 15000 });
  await shot(player, "3-player-no-session");
  console.log("  PASS  錯誤的密碼顯示「無此場次」");

  // ---- 4. 玩家用開場密碼入場 ----
  await player.fill('input[placeholder="主持人會告訴你"]', PASSWORD);
  await player.click('button[type="submit"]');
  await player.waitForURL(`**/player/${CODE}`, { timeout: 20000 });
  await player.waitForSelector('button:has-text("周謙")', { timeout: 20000 });
  await player.fill('label:has-text("你的暱稱") input', "阿謙");
  await player.click('button:has-text("周謙")');
  await shot(player, "4-player-join");
  await player.click('button:has-text("入府")');
  await player.waitForSelector("text=勢力排名", { timeout: 20000 });
  console.log("  PASS  玩家用開場密碼入場成功");

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

  // ---- 8.5 掉線回場：清掉瀏覽器身分，用暱稱把角色認回來 ----
  await player.evaluate(() => localStorage.clear());
  await player.reload({ waitUntil: "networkidle" });
  await player.waitForSelector('button:has-text("周謙")', { timeout: 20000 });
  check("清掉身分後回到選角畫面", await player.isVisible('button:has-text("周謙")'), true);

  // 先點已經被選走的角色，畫面才會切成「認回」模式
  await player.click('button:has-text("周謙")');
  await player.waitForSelector('label:has-text("你入場時填的暱稱")', { timeout: 20000 });

  // 用錯的暱稱：要被擋下來，而且不能洩漏正確答案
  await player.fill('label:has-text("你入場時填的暱稱") input', "打錯了");
  await player.click('button:has-text("以暱稱認回")');
  await player.waitForSelector("text=暱稱不正確", { timeout: 20000 });
  const wrongText = await player.innerText("body");
  check("錯誤訊息不洩漏正確暱稱", /阿謙/.test(wrongText.replace(/周謙/g, "")), false);

  // 換成正確的暱稱
  await player.fill('label:has-text("你入場時填的暱稱") input', "阿謙");
  await player.click('button:has-text("以暱稱認回")');
  await player.waitForSelector("text=場 次 資 訊", { timeout: 20000 });
  await shot(player, "11-player-rejoined");
  const backText = await player.innerText("body");
  check("認回後看得到自己的暱稱", /阿謙/.test(backText), true);
  console.log("  PASS  玩家清掉瀏覽器資料後用暱稱認回角色");

  // ---- 8.7 競選投票：全部投完才能離開第一週 ----
  await host.click('nav button:has-text("舉報")');
  await host.waitForSelector("text=競 選 投 票 進 度", { timeout: 20000 });
  check("主持人看得到投票進度", await host.isVisible("text=還有人沒投"), true);

  // 先確認沒投完真的走不了
  await host.click('nav button:has-text("階段")');
  await expectFailure(async () => {
    await host.click('button:has-text("第二週：暗算九爺")');
    await host.waitForSelector("text=/沒投完票/", { timeout: 20000 });
  });
  check("沒投完擋下換階段", true, true);

  // 玩家用畫面投一票，其餘的用 API 補完（三人場每人 2 張同意、0 張不同意）
  await player.click('nav button:has-text("行動")');
  await player.waitForSelector("text=競 選 投 票", { timeout: 20000 });
  await player.selectOption('select:near(:text("競 選 投 票"))', { index: 1 });
  player.once("dialog", (d) => d.accept());
  await player.click('button:has-text("同意（")');
  await player.waitForSelector("text=/已投給/", { timeout: 20000 });
  console.log("  PASS  玩家從畫面投出一票");

  const roster = await (await fetch(`${BASE}/api/sessions/${CODE}/state`, {
    headers: { "x-host-pin": PASSWORD },
  })).json();
  const ids = roster.players.map((p) => ({ id: p.id, joinCode: p.joinCode }));
  for (const voter of ids) {
    for (const target of ids.filter((t) => t.id !== voter.id)) {
      await fetch(`${BASE}/api/sessions/${CODE}/votes`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-player-id": voter.id,
          "x-join-code": voter.joinCode,
        },
        body: JSON.stringify({ targetId: target.id, kind: "approve" }),
      });
    }
  }

  await host.reload({ waitUntil: "networkidle" });
  await host.waitForSelector("text=玩 家", { timeout: 20000 });
  await host.click('nav button:has-text("舉報")');
  await host.waitForSelector("text=全部投完", { timeout: 20000 });
  check("全部投完後主持人看得到", true, true);
  await shot(host, "16-host-vote");

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

  // ---- 10. 故事復盤：聘書發放後才出現 ----
  await player.click('button:has-text("查看故事復盤")');
  await player.waitForSelector("text=陣營部分復盤", { timeout: 20000 });
  const storyText = await player.innerText("body");
  check("復盤載入完成", /商會的由來/.test(storyText), true);
  check("有角色身份", /角色身份/.test(storyText), true);
  check("揭露陸秉白真名", /陸無病/.test(storyText), true);
  check("標出自己扮演的角色", /你扮演的角色/.test(storyText), true);
  check("有下一部預告", /下一部作品/.test(storyText), true);
  await shot(player, "12-player-story");

  // 復盤很長，頁面本身仍然不該捲動——由內層區塊自己捲
  const storyMetrics = await player.evaluate(() => ({
    pageScroll: document.documentElement.scrollHeight - window.innerHeight,
    canScrollInside: (() => {
      const el = document.querySelector(".app-scroll");
      return el ? el.scrollHeight > el.clientHeight : false;
    })(),
  }));
  check("復盤頁面本身不捲動", storyMetrics.pageScroll <= 1, true);
  check("內層可以捲", storyMetrics.canScrollInside, true);

  await player.click('button:has-text("返回")');
  await player.waitForSelector("text=場 次 資 訊", { timeout: 20000 });
  console.log("  PASS  故事復盤可開可關");
  // ---- 11. 場次結束後，玩家回來看得到自己的紀錄 ----
  await host.click('nav button:has-text("設定")');
  // 結束的瞬間，玩家端還在輪詢的那一發會 404——那正是客戶端用來察覺
  // 「這場結束了」的訊號，不是錯誤。只在這段期間放行。
  await expectFailure(async () => {
    host.once("dialog", (d) => d.accept());
    await host.click('button:has-text("結束")');
    await host.waitForTimeout(2500);
    await player.reload({ waitUntil: "networkidle" });
    await player.waitForSelector("text=回顧", { timeout: 20000 });
  });
  const reviewText = await player.innerText("body");
  check("結束後顯示回顧畫面", /我 的 紀 錄/.test(reviewText), true);
  check("回顧看得到最終勢力值", /最終勢力值/.test(reviewText), true);
  check("回顧看得到聘書", /聘\s*書/.test(reviewText), true);
  check("回顧看得到自己的暱稱", /阿謙/.test(reviewText), true);
  await shot(player, "17-player-review");

  // 復盤在散場後也還看得到
  await player.click('button:has-text("查看故事復盤")');
  await player.waitForSelector("text=陣營部分復盤", { timeout: 20000 });
  check("散場後仍看得到故事復盤", true, true);
  await player.click('button:has-text("返回")');
  await player.waitForSelector("text=我 的 紀 錄", { timeout: 20000 });

  await assertNoPageScroll(player, "玩家（回顧）", []);
  console.log("  PASS  場次結束後玩家仍看得到自己的紀錄");
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
