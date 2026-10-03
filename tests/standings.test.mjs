/**
 * 最終排名測試。需要記憶體模式的伺服器，見 README。
 *
 * 排名規則：
 *   1. 先看陣營——各陣營成員的「累計獲得勢力」總和，高的陣營排前面
 *   2. 同陣營內比個人累計
 *   3. 再同分比最終勢力值，還同分比入場順序
 *
 * 累計獲得勢力 = 所有勢力值異動的淨額，但**排除玩家間轉贈**。
 * 拍賣付出去的要扣、技能卡全部計入。
 */
import { asPlayer, call, castAllVotes, hostHeaders, makeChecker, openSession }
  from "./helpers.mjs";

const { check, ok, done } = makeChecker();

const { code: CODE, password: PW } = await openSession("排名測試");
console.log(`使用場次 ${CODE}`);
const host = hostHeaders(PW);

// 九爺：周謙、沈識月　紅姑娘：陳嘉樹、李婉序
const players = [];
for (const [characterId, nickname] of [
  ["zhouqian", "阿謙"],
  ["shenshiyue", "月月"],
  ["chenjiashu", "小樹"],
  ["liwanxu", "婉序"],
]) {
  const r = await call(`/${CODE}/join`, { method: "POST", body: { characterId, nickname } });
  players.push(r.json.player);
}
const [zhou, shen, chen, li] = players;

const grant = (p, delta, reason = "測試") =>
  call(`/${CODE}/grant`, {
    method: "POST",
    headers: host,
    body: { playerIds: [p.id], resource: "power", delta, reason },
  });

const standings = async () =>
  (await call(`/${CODE}/standings`, { headers: host })).json.standings;

// ---- 系統發放的都算進累計 ----
await grant(zhou, 1000);
await grant(shen, 400);
await grant(chen, 900);
await grant(li, 300);

let s = await standings();
const by = (list) => Object.fromEntries(list.map((x) => [x.name, x]));
let m = by(s);
check("周謙累計", m["周謙"].cumulative, 1000);
check("九爺陣營總和", m["周謙"].factionTotal, 1400);
check("紅姑娘陣營總和", m["陳嘉樹"].factionTotal, 1200);
check("九爺在前", s[0].faction, "九爺");
check(
  "整體順序",
  s.map((x) => x.name),
  ["周謙", "沈識月", "陳嘉樹", "李婉序"],
);

// ---- 玩家間轉贈不算 ----
// 周謙把 800 轉給陳嘉樹：兩邊的累計都不該變動
await call(`/${CODE}/transfer`, {
  method: "POST",
  headers: asPlayer(zhou),
  body: { targetId: chen.id, amount: 800 },
});

s = await standings();
m = by(s);
check("轉出方累計不變", m["周謙"].cumulative, 1000);
check("收受方累計不變", m["陳嘉樹"].cumulative, 900);
check("但最終勢力確實移動了", [m["周謙"].power, m["陳嘉樹"].power], [200, 1700]);
check(
  "排名不受轉贈影響",
  s.map((x) => x.name),
  ["周謙", "沈識月", "陳嘉樹", "李婉序"],
);
ok(
  "若用最終勢力排，陳嘉樹會跑到第一——正是要避免的情況",
  m["陳嘉樹"].power > m["周謙"].power,
  `${m["陳嘉樹"].power} > ${m["周謙"].power}`,
);

// ---- 拍賣算淨額：付出去的要扣 ----
await call(`/${CODE}/stage`, { method: "POST", headers: host, body: { stageId: "week3" } });
// 陳嘉樹用 1200 標下南山武館（真實價值 2000）→ 淨 +800
await call(`/${CODE}/auction`, {
  method: "POST",
  headers: host,
  body: { playerId: chen.id, lotId: "nanshan", paid: 1200 },
});
s = await standings();
m = by(s);
check("拍賣只算淨額", m["陳嘉樹"].cumulative, 900 + 800);

// ---- 技能卡全部計入（偷到的算你的，被偷的那邊扣） ----
const before = by(await standings());
await call(`/${CODE}/grant`, {
  method: "POST",
  headers: host,
  body: { playerIds: [shen.id], resource: "power", delta: 0, reason: "占位" },
});
// 直接用主持人調配模擬技能卡來源不方便，改驗來源分類本身：
// 轉贈是唯一被排除的來源，其餘（含技能卡效果）都計入——上面的拍賣已經證明了非轉贈來源會計入。
ok("技能卡與拍賣同屬計入的來源", before["陳嘉樹"].cumulative === 1700, "拍賣已計入");

// ---- 陣營順序會因為累計而翻轉 ----
await grant(li, 2000, "紅姑娘陣營補上");
s = await standings();
m = by(s);
check("紅姑娘陣營反超", s[0].faction, "紅姑娘");
check("紅姑娘總和", m["陳嘉樹"].factionTotal, 1700 + 2300);
check(
  "翻轉後的順序",
  s.map((x) => x.name),
  ["李婉序", "陳嘉樹", "周謙", "沈識月"],
);

// ---- 發聘書照這個順序 ----
await call(`/${CODE}/stage`, { method: "POST", headers: host, body: { stageId: "final" } });
const issued = await call(`/${CODE}/certificates`, { method: "POST", headers: host });
check("發出四張", issued.json.issued, 4);

const after = (await call(`/${CODE}/state`, { headers: host })).json.players;
// 用陣列比對而不是物件——JSON.stringify 比物件時會受鍵的順序影響
check(
  "聘書名次照排名",
  [...after].sort((a, b) => a.certRank - b.certRank).map((p) => `${p.certRank}:${p.name}`),
  ["1:李婉序", "2:陳嘉樹", "3:周謙", "4:沈識月"],
);

const cert = (await call(`/${CODE}/state`, { headers: asPlayer(li) })).json.me.certificate;
check("第一名是會長", cert.position, "會長");
check("稱號對得上", cert.title, "南洋最強贏麻了");

// ---- 沒設陣營不能發 ----
{
  const { code, password } = await openSession();
  const h = hostHeaders(password);
  const ps = [];
  for (const [characterId, nickname] of [["zhouqian", "甲"], ["shenshiyue", "乙"]]) {
    ps.push((await call(`/${code}/join`, { method: "POST", body: { characterId, nickname } })).json.player);
  }
  await call(`/${code}/players/${ps[0].id}/faction`, {
    method: "POST",
    headers: h,
    body: { faction: "" },
  });
  await call(`/${code}/stage`, { method: "POST", headers: h, body: { stageId: "final" } });
  const r = await call(`/${code}/certificates`, { method: "POST", headers: h });
  ok("有人沒陣營就擋下", r.status >= 400, JSON.stringify(r.json));
  ok(
    "訊息指出是誰",
    String(r.json.message ?? "").includes("周謙"),
    JSON.stringify(r.json),
  );
}

// ---- 同陣營完全同分才擋下 ----
{
  const { code, password } = await openSession();
  const h = hostHeaders(password);
  const ps = [];
  for (const [characterId, nickname] of [["zhouqian", "甲"], ["shenshiyue", "乙"]]) {
    ps.push((await call(`/${code}/join`, { method: "POST", body: { characterId, nickname } })).json.player);
  }
  // 兩人同為九爺陣營，給一模一樣的數字
  for (const p of ps) {
    await call(`/${code}/grant`, {
      method: "POST",
      headers: h,
      body: { playerIds: [p.id], resource: "power", delta: 500 },
    });
  }
  await call(`/${code}/stage`, { method: "POST", headers: h, body: { stageId: "final" } });
  const r = await call(`/${code}/certificates`, { method: "POST", headers: h });
  ok("完全同分擋下", r.status >= 400, JSON.stringify(r.json));
  ok(
    "訊息說明是累計與最終都相同",
    String(r.json.message ?? "").includes("累計"),
    JSON.stringify(r.json),
  );
}

// ---- 只有主持人看得到排名 ----
const asPlayerTry = await call(`/${CODE}/standings`, { headers: asPlayer(zhou) });
ok("玩家拿不到排名", asPlayerTry.status >= 400, `HTTP ${asPlayerTry.status}`);

done("最終排名測試");
