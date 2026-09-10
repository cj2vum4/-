/**
 * 聘書、暱稱與批次招募的端對端測試。
 *
 * 需要一台跑在記憶體儲存模式的伺服器（不要接到正式試算表）：
 *   GOOGLE_SHEETS_SPREADSHEET_ID= GOOGLE_SERVICE_ACCOUNT_JSON= npx next start -p 3100
 *   node tests/certificate.test.mjs
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
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const host = { "x-host-pin": PIN };
const asPlayer = (p) => ({ "x-player-id": p.id, "x-join-code": p.joinCode });

const CODE = `2031-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`;
console.log(`使用場次 ${CODE}`);

// ---- 開場 ----
const created = await call("", { method: "POST", body: { date: CODE, hostPin: PIN } });
ok("主持人開場", created.status === 200, JSON.stringify(created.json));

// ---- 入場一定要有暱稱 ----
const noNick = await call(`/${CODE}/join`, {
  method: "POST",
  body: { characterId: "zhouqian", nickname: "  " },
});
ok("沒填暱稱不能入場", noNick.status >= 400, `HTTP ${noNick.status}`);

const tooLong = await call(`/${CODE}/join`, {
  method: "POST",
  body: { characterId: "zhouqian", nickname: "字".repeat(21) },
});
ok("暱稱超過 20 字被擋下", tooLong.status >= 400, `HTTP ${tooLong.status}`);

// ---- 三名玩家入場 ----
const roster = [
  ["zhouqian", "阿謙"],
  ["shenshiyue", "月月"],
  ["chenjiashu", "小樹"],
];
const players = [];
for (const [characterId, nickname] of roster) {
  const r = await call(`/${CODE}/join`, { method: "POST", body: { characterId, nickname } });
  ok(`${nickname} 入場`, r.status === 200, JSON.stringify(r.json));
  players.push(r.json.player ?? r.json);
}
const nicknames = [];
for (const p of players) {
  const s = await call(`/${CODE}/state`, { headers: asPlayer(p) });
  nicknames.push(s.json.me.nickname);
}
check("暱稱有存下來", nicknames, ["阿謙", "月月", "小樹"]);

// ---- 玩家可以改自己的暱稱 ----
const renamed = await call(`/${CODE}/nickname`, {
  method: "POST",
  headers: asPlayer(players[2]),
  body: { nickname: "樹哥" },
});
check("玩家改暱稱", renamed.json.nickname, "樹哥");

const stolen = await call(`/${CODE}/nickname`, {
  method: "POST",
  headers: asPlayer({ id: players[2].id, joinCode: "0000" }),
  body: { nickname: "駭客" },
});
ok("入場碼不對不能改暱稱", stolen.status >= 400, `HTTP ${stolen.status}`);

// ---- 批次招募：第一週開招募但不發次數，第二週才發 ----
await call(`/${CODE}/stage`, { method: "POST", headers: host, body: { stageId: "week1" } });
const week1 = await call(`/${CODE}/state`, { headers: asPlayer(players[0]) });
check("第一週招募開放", week1.json.session.recruitOpen, true);
check("第一週不發招募次數", week1.json.me.drawsRemaining, 0);

await call(`/${CODE}/stage`, { method: "POST", headers: host, body: { stageId: "week2" } });
const before = await call(`/${CODE}/state`, { headers: asPlayer(players[0]) });
const drawsBefore = before.json.me.drawsRemaining;
ok("第二週有發招募次數", drawsBefore > 0, `drawsRemaining=${drawsBefore}`);

const one = await call(`/${CODE}/recruit/draw`, {
  method: "POST",
  headers: asPlayer(players[0]),
  body: { times: 1 },
});
check("抽 1 次拿到 1 張", one.json.items.length, 1);
check("抽 1 次後剩餘次數", one.json.drawsRemaining, drawsBefore - 1);

const five = await call(`/${CODE}/recruit/draw`, {
  method: "POST",
  headers: asPlayer(players[0]),
  body: { times: 5 },
});
const wanted = Math.min(5, drawsBefore - 1);
check("抽 5 次拿到的張數", five.json.items.length, wanted);
check("抽 5 次後剩餘次數", five.json.drawsRemaining, drawsBefore - 1 - wanted);

const powerFromItems = five.json.items
  .filter((i) => i.kind === "power")
  .reduce((sum, i) => sum + i.amount, 0);
check("powerGained 等於各張勢力值加總", five.json.powerGained, powerFromItems);

const afterDraw = await call(`/${CODE}/state`, { headers: asPlayer(players[0]) });
check(
  "勢力值餘額對得上",
  afterDraw.json.me.power,
  one.json.powerGained + five.json.powerGained,
);

const tooMany = await call(`/${CODE}/recruit/draw`, {
  method: "POST",
  headers: asPlayer(players[0]),
  body: { times: 99 },
});
ok("一次抽超過 10 張被擋下", tooMany.status >= 400, `HTTP ${tooMany.status}`);

// ---- 聘書 ----
await call(`/${CODE}/stage`, { method: "POST", headers: host, body: { stageId: "final" } });

// 先把三人的勢力值拉成不同數字，才判得出名次
const powers = [5000, 3000, 1000];
for (let i = 0; i < players.length; i++) {
  const cur = await call(`/${CODE}/state`, { headers: asPlayer(players[i]) });
  await call(`/${CODE}/grant`, {
    method: "POST",
    headers: host,
    body: { playerIds: [players[i].id], resource: "power", delta: powers[i] - cur.json.me.power },
  });
}

const issued = await call(`/${CODE}/certificates`, { method: "POST", headers: host });
check("發出三張聘書", issued.json.issued, 3);

const expected = [
  { rank: 1, nickname: "阿謙", position: "會長", title: "南洋最強贏麻了" },
  { rank: 2, nickname: "月月", position: "副會長", title: "差一點稱霸南洋" },
  { rank: 3, nickname: "樹哥", position: "副會長", title: "差二點稱霸南洋" },
];
for (let i = 0; i < players.length; i++) {
  const s = await call(`/${CODE}/state`, { headers: asPlayer(players[i]) });
  const cert = s.json.me.certificate;
  check(`第 ${i + 1} 名的聘書`, cert && {
    rank: cert.rank, nickname: cert.nickname, position: cert.position, title: cert.title,
  }, expected[i]);
  check(`第 ${i + 1} 名聘書日期用場次日期`, cert?.date, CODE);
}

// 別人的聘書不該外洩
const board = await call(`/${CODE}/state`, { headers: asPlayer(players[1]) });
const leaked = JSON.stringify(board.json.players ?? []);
ok("榜單上看不到別人的聘書", !leaked.includes("南洋最強贏麻了"), leaked);

// 聘書發完就不能再改暱稱
const lateRename = await call(`/${CODE}/nickname`, {
  method: "POST",
  headers: asPlayer(players[0]),
  body: { nickname: "改名了" },
});
ok("聘書發放後不能改暱稱", lateRename.status >= 400, `HTTP ${lateRename.status}`);

// ---- 同分時擋下來，不自行判定會長 ----
const TIE = `2032-03-0${1 + Math.floor(Math.random() * 8)}`;
await call("", { method: "POST", body: { date: TIE, hostPin: PIN } });
const tiePlayers = [];
for (const [characterId, nickname] of [["zhouqian", "甲"], ["shenshiyue", "乙"]]) {
  const r = await call(`/${TIE}/join`, { method: "POST", body: { characterId, nickname } });
  tiePlayers.push(r.json.player ?? r.json);
}
await call(`/${TIE}/stage`, { method: "POST", headers: host, body: { stageId: "final" } });
for (const p of tiePlayers) {
  await call(`/${TIE}/grant`, {
    method: "POST",
    headers: host,
    body: { playerIds: [p.id], resource: "power", delta: 777 },
  });
}
const tieRes = await call(`/${TIE}/certificates`, { method: "POST", headers: host });
ok("第一二名同分時擋下發放", tieRes.status >= 400, `HTTP ${tieRes.status}`);
ok("同分錯誤訊息說得清楚", String(tieRes.json.message ?? "").includes("無法自動判定會長"),
  JSON.stringify(tieRes.json));

// ---- 沒填暱稱擋下發放（用舊資料模擬：直接建一場，改成空暱稱做不到，改用未入場檢查） ----
const EMPTY = `2033-04-0${1 + Math.floor(Math.random() * 8)}`;
await call("", { method: "POST", body: { date: EMPTY, hostPin: PIN } });
await call(`/${EMPTY}/stage`, { method: "POST", headers: host, body: { stageId: "final" } });
const emptyRes = await call(`/${EMPTY}/certificates`, { method: "POST", headers: host });
ok("沒有玩家時擋下發放", emptyRes.status >= 400, `HTTP ${emptyRes.status}`);

console.log(failed === 0 ? "\n聘書與招募測試全部通過" : `\n${failed} 個案例失敗`);
process.exit(failed === 0 ? 0 : 1);
