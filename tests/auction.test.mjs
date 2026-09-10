/**
 * 拍賣結算測試。需要記憶體模式的伺服器，見 README。
 *
 * 規則：現場喊價，主持人輸入得標者付了多少；系統先扣出價，再入帳標的的
 * 真實價值，差額就是賺賠。
 */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const PIN = "8888";

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        實際 ${JSON.stringify(actual)}\n        預期 ${JSON.stringify(expected)}`);
}
function ok(label, cond, detail = "") {
  if (!cond) failed++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `\n        ${detail}`}`);
}

async function call(path, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(`${BASE}/api/sessions${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const host = { "x-host-pin": PIN };
const asPlayer = (p) => ({ "x-player-id": p.id, "x-join-code": p.joinCode });

const CODE = `2038-0${1 + Math.floor(Math.random() * 9)}-1${1 + Math.floor(Math.random() * 8)}`;
console.log(`使用場次 ${CODE}`);

await call("", { method: "POST", body: { date: CODE, hostPin: PIN } });
const players = [];
for (const [characterId, nickname] of [["zhouqian", "阿謙"], ["shenshiyue", "月月"]]) {
  const r = await call(`/${CODE}/join`, { method: "POST", body: { characterId, nickname } });
  players.push(r.json.player);
}
const [buyer, bystander] = players;

await call(`/${CODE}/stage`, { method: "POST", headers: host, body: { stageId: "week3" } });

// 先給買家一筆本金
await call(`/${CODE}/grant`, {
  method: "POST",
  headers: host,
  body: { playerIds: [buyer.id], resource: "power", delta: 5000 },
});

// ---- 賺錢的一標：南山武館價值 2000，用 1200 標到 ----
const win = await call(`/${CODE}/auction`, {
  method: "POST",
  headers: host,
  body: { playerId: buyer.id, lotId: "nanshan", paid: 1200 },
});
check("賺錢：付出", win.json.paid, 1200);
check("賺錢：價值", win.json.value, 2000);
check("賺錢：賺賠", win.json.net, 800);
check("賺錢：餘額", win.json.balance, 5000 - 1200 + 2000);

const afterWin = await call(`/${CODE}/state`, { headers: asPlayer(buyer) });
check("餘額真的寫進去了", afterWin.json.me.power, 5800);

// 帳目要分成扣款與入帳兩筆，玩家才看得懂錢的來去
const myLog = afterWin.json.log.filter((e) => e.resource === "勢力值");
ok("有扣款那一筆", myLog.some((e) => e.delta === -1200), JSON.stringify(myLog).slice(0, 300));
ok("有入帳那一筆", myLog.some((e) => e.delta === 2000), JSON.stringify(myLog).slice(0, 300));

// ---- 賠錢的一標：百老匯價值 1500，用 2500 搶到 ----
const lose = await call(`/${CODE}/auction`, {
  method: "POST",
  headers: host,
  body: { playerId: buyer.id, lotId: "broadway", paid: 2500 },
});
check("賠錢：賺賠是負的", lose.json.net, -1000);
check("賠錢：餘額", lose.json.balance, 5800 - 2500 + 1500);

// ---- 南洋花滿樓價值不固定，要一起輸入 ----
const missing = await call(`/${CODE}/auction`, {
  method: "POST",
  headers: host,
  body: { playerId: buyer.id, lotId: "huamanlou", paid: 500 },
});
ok("花滿樓沒填價值會擋下", missing.status >= 400, JSON.stringify(missing.json));
ok(
  "訊息說得清楚",
  String(missing.json.message ?? "").includes("價值不固定"),
  JSON.stringify(missing.json),
);

const manual = await call(`/${CODE}/auction`, {
  method: "POST",
  headers: host,
  body: { playerId: buyer.id, lotId: "huamanlou", paid: 500, value: 3000 },
});
check("花滿樓帶價值就算得出來", manual.json.net, 2500);

// ---- 出價超過餘額要擋下，那多半是打錯字 ----
const broke = await call(`/${CODE}/auction`, {
  method: "POST",
  headers: host,
  body: { playerId: bystander.id, lotId: "nanya", paid: 9999 },
});
ok("付不出來會擋下", broke.status >= 400, JSON.stringify(broke.json));
ok(
  "錯誤訊息報出目前餘額",
  /只有 \d+ 勢力值/.test(String(broke.json.message ?? "")),
  JSON.stringify(broke.json),
);

// ---- 輸入檢查 ----
for (const [label, body] of [
  ["負數出價", { playerId: buyer.id, lotId: "nanshan", paid: -100 }],
  ["小數出價", { playerId: buyer.id, lotId: "nanshan", paid: 10.5 }],
  ["不存在的標的", { playerId: buyer.id, lotId: "nope", paid: 100 }],
  ["不存在的玩家", { playerId: "PZZZZZZ", lotId: "nanshan", paid: 100 }],
]) {
  const r = await call(`/${CODE}/auction`, { method: "POST", headers: host, body });
  ok(`${label}會擋下`, r.status >= 400, JSON.stringify(r.json));
}

// ---- 主持人專屬：玩家不能自己結算，也看不到別人的拍賣 ----
const asPlayerTry = await call(`/${CODE}/auction`, {
  method: "POST",
  headers: asPlayer(buyer),
  body: { playerId: buyer.id, lotId: "nanshan", paid: 100 },
});
ok("玩家不能自己結算拍賣", asPlayerTry.status >= 400, JSON.stringify(asPlayerTry.json));

const other = await call(`/${CODE}/state`, { headers: asPlayer(bystander) });
ok(
  "旁人看不到別人的拍賣帳",
  !JSON.stringify(other.json.log ?? []).includes("南山武館"),
  JSON.stringify(other.json.log ?? []).slice(0, 300),
);

console.log(failed === 0 ? "\n拍賣測試全部通過" : `\n${failed} 個案例失敗`);
process.exit(failed === 0 ? 0 : 1);
