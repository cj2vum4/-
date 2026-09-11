/**
 * 場次身分與封存測試。需要記憶體模式的伺服器，見 README。
 *
 * 兩件事：
 *   1. 場次改用「開場密碼」辨識，所以同一天可以開很多場
 *   2. 結束場次時自動把三個工作分頁彙整成一個以日期命名的分頁
 */
import { asPlayer, call, hostHeaders, makeChecker, openSession, randomPassword }
  from "./helpers.mjs";

const { check, ok, done } = makeChecker();

// ---- 同一天可以開兩場，代碼自動加序號 ----
const a = await openSession("上午場");
const b = await openSession("下午場");
console.log(`兩場：${a.code} / ${b.code}`);

const today = new Date();
const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
  today.getDate(),
).padStart(2, "0")}`;
ok("代碼用當天日期", a.code.startsWith(stamp), a.code);
ok("兩場代碼不一樣", a.code !== b.code, `${a.code} vs ${b.code}`);
ok("第二場帶序號", /-\d+$/.test(b.code) || /-\d+$/.test(a.code), `${a.code} / ${b.code}`);

// ---- 玩家用密碼進場，各自進到正確的場次 ----
const lookA = await call("/lookup", { method: "POST", body: { password: a.password } });
const lookB = await call("/lookup", { method: "POST", body: { password: b.password } });
check("密碼 A 對到場次 A", lookA.json.session.code, a.code);
check("密碼 B 對到場次 B", lookB.json.session.code, b.code);

const missing = await call("/lookup", { method: "POST", body: { password: randomPassword("no") } });
ok("查不到就是無此場次", missing.status === 404, `HTTP ${missing.status}`);
check("訊息就是「無此場次」", missing.json.message, "無此場次");

// ---- 密碼規則 ----
const tooShort = await call("", { method: "POST", body: { password: "abc" } });
ok("密碼太短會擋下", tooShort.status >= 400, JSON.stringify(tooShort.json));

const dup = await call("", { method: "POST", body: { password: a.password } });
ok("同一組密碼不能同時開兩場", dup.status >= 400, JSON.stringify(dup.json));

// ---- 主持人用同一組密碼進主持台 ----
const verify = await call(`/${a.code}/verify-host`, {
  method: "POST",
  headers: hostHeaders(a.password),
});
ok("開場密碼可進主持台", verify.status === 200, JSON.stringify(verify.json));

const wrong = await call(`/${a.code}/verify-host`, {
  method: "POST",
  headers: hostHeaders(b.password),
});
ok("別場的密碼進不去", wrong.status >= 400, JSON.stringify(wrong.json));

// ---- 玩一小段，然後結束並封存 ----
const hostA = hostHeaders(a.password);
const players = [];
for (const [characterId, nickname] of [["zhouqian", "阿謙"], ["shenshiyue", "月月"]]) {
  const r = await call(`/${a.code}/join`, { method: "POST", body: { characterId, nickname } });
  players.push(r.json.player);
}
await call(`/${a.code}/stage`, { method: "POST", headers: hostA, body: { stageId: "week1" } });
await call(`/${a.code}/grant`, {
  method: "POST",
  headers: hostA,
  body: { playerIds: [players[0].id], resource: "power", delta: 1234 },
});

const closed = await call(`/${a.code}/status`, {
  method: "POST",
  headers: hostA,
  body: { status: "closed" },
});
ok("結束場次成功", closed.status === 200, JSON.stringify(closed.json));
check("已標記封存", closed.json.session.archived, true);

// ---- 封存後不能再玩，但密碼仍要找得到那一場（散場後回來看紀錄用的） ----
const afterLookup = await call("/lookup", { method: "POST", body: { password: a.password } });
check("封存後密碼仍找得到場次", afterLookup.json.session?.code, a.code);
check("而且標記為已結束", afterLookup.json.session?.archived, true);

const afterJoin = await call(`/${a.code}/join`, {
  method: "POST",
  body: { characterId: "chenjiashu", nickname: "來不及" },
});
ok("封存後不能入場", afterJoin.status >= 400, JSON.stringify(afterJoin.json));

const afterHost = await call(`/${a.code}/grant`, {
  method: "POST",
  headers: hostA,
  body: { playerIds: [players[0].id], resource: "power", delta: 1 },
});
ok("封存後不能調配", afterHost.status >= 400, JSON.stringify(afterHost.json));

const reopen = await call(`/${a.code}/status`, {
  method: "POST",
  headers: hostA,
  body: { status: "open" },
});
ok("封存後不能重新開放", reopen.status >= 400, JSON.stringify(reopen.json));

// ---- 另一場不受影響，還能繼續玩 ----
const bStill = await call("/lookup", { method: "POST", body: { password: b.password } });
check("另一場還在", bStill.json.session.code, b.code);

const bJoin = await call(`/${b.code}/join`, {
  method: "POST",
  body: { characterId: "zhouqian", nickname: "另一場的人" },
});
ok("另一場還能入場", bJoin.status === 200, JSON.stringify(bJoin.json));

// ---- 密碼在封存後可以重複使用 ----
const reuse = await call("", { method: "POST", body: { password: a.password } });
ok("封存後密碼可以再用來開新場", reuse.status === 200, JSON.stringify(reuse.json));
ok("而且是新的代碼", reuse.json.session?.code !== a.code, reuse.json.session?.code);

// ---- 列表不含密碼 ----
const list = await call("", {});
ok(
  "場次列表不含密碼",
  !JSON.stringify(list.json).includes(a.password),
  JSON.stringify(list.json).slice(0, 300),
);

done("場次與封存測試");
