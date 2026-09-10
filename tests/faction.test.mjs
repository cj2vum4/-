/**
 * 真實陣營的端對端測試。
 *
 * 需要記憶體模式的伺服器，見 README「需要伺服器的測試」。
 *
 * 這裡最重要的一條是「玩家端拿不到任何人的陣營」——陣營一旦外洩，
 * 整個陣營博弈就沒了。
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

const CODE = `2036-0${1 + Math.floor(Math.random() * 9)}-2${Math.floor(Math.random() * 8)}`;
console.log(`使用場次 ${CODE}`);

await call("", { method: "POST", body: { date: CODE, hostPin: PIN } });

const ROSTER = [
  ["zhouqian", "周謙", "九爺"],
  ["shenshiyue", "沈識月", "九爺"],
  ["jixiuyuan", "季修遠", "九爺"],
  ["chenjiashu", "陳嘉樹", "紅姑娘"],
  ["liwanxu", "李婉序", "紅姑娘"],
  ["shangyu", "商羽", "紅姑娘"],
  ["lubingbai", "陸秉白", "隱藏鬼老"],
];

const players = [];
for (const [characterId, , ] of ROSTER) {
  const r = await call(`/${CODE}/join`, {
    method: "POST",
    body: { characterId, nickname: `暱稱${players.length + 1}` },
  });
  players.push(r.json.player);
}

// ---- 入場就依劇本套用陣營 ----
const hostState = await call(`/${CODE}/state`, { headers: host });
const byCharacter = Object.fromEntries(
  hostState.json.players.map((p) => [p.characterId, p.faction]),
);
for (const [characterId, name, faction] of ROSTER) {
  check(`${name} 的陣營`, byCharacter[characterId], faction);
}

// ---- 主持台拿得到劇本原訂陣營，用來標示被改動過的人 ----
check("主持台拿到劇本陣營對應", hostState.json.scriptFactions.lubingbai, "隱藏鬼老");

// ---- 玩家端一個字都不能看到陣營 ----
const seen = await call(`/${CODE}/state`, { headers: asPlayer(players[0]) });
const dump = JSON.stringify(seen.json);
ok("玩家端沒有 faction 欄位", !dump.includes("faction"), dump.slice(0, 300));
for (const f of ["九爺", "紅姑娘", "隱藏鬼老"]) {
  ok(`玩家端看不到「${f}」`, !dump.includes(f), dump.slice(0, 300));
}

// 選角畫面（未入場也能打）也不能帶出陣營
const lobby = await call(`/${CODE}`);
const lobbyDump = JSON.stringify(lobby.json);
ok("選角畫面沒有陣營", !/九爺|紅姑娘|隱藏鬼老/.test(lobbyDump), lobbyDump.slice(0, 300));

// ---- 陸秉白改投其他陣營，主持人改得動 ----
const lu = players[6];
await call(`/${CODE}/players/${lu.id}/faction`, {
  method: "POST",
  headers: host,
  body: { faction: "九爺" },
});
const afterSwitch = await call(`/${CODE}/state`, { headers: host });
check(
  "陸秉白改投九爺",
  afterSwitch.json.players.find((p) => p.id === lu.id).faction,
  "九爺",
);
check(
  "劇本陣營仍是隱藏鬼老（供主持台標示已改動）",
  afterSwitch.json.scriptFactions.lubingbai,
  "隱藏鬼老",
);

// ---- 套用劇本陣營只補空的，不覆蓋主持人改過的 ----
await call(`/${CODE}/players/${players[0].id}/faction`, {
  method: "POST",
  headers: host,
  body: { faction: "" },
});
const applied = await call(`/${CODE}/factions`, { method: "POST", headers: host });
check("只補一個沒設定的", applied.json.applied, 1);

const afterApply = await call(`/${CODE}/state`, { headers: host });
const byId = Object.fromEntries(afterApply.json.players.map((p) => [p.id, p.faction]));
check("被清空的周謙補回九爺", byId[players[0].id], "九爺");
check("陸秉白維持主持人改的九爺", byId[lu.id], "九爺");

const again = await call(`/${CODE}/factions`, { method: "POST", headers: host });
check("沒有空的就不動任何人", again.json.applied, 0);

// ---- 陣營異動的紀錄不可對玩家公開 ----
const playerLog = await call(`/${CODE}/state`, { headers: asPlayer(players[1]) });
ok(
  "玩家端動態看不到陣營紀錄",
  !JSON.stringify(playerLog.json.log ?? []).match(/陣營|九爺|紅姑娘|鬼老/),
  JSON.stringify(playerLog.json.log ?? []).slice(0, 300),
);

console.log(failed === 0 ? "\n陣營測試全部通過" : `\n${failed} 個案例失敗`);
process.exit(failed === 0 ? 0 : 1);
