/**
 * 第一週「競選會長助理」投票測試。需要記憶體模式的伺服器，見 README。
 *
 * 規則：每人同意票 2 張、不同意票 1 張，三張要投給三個不同的人，不能投自己。
 * 全部投完主持人才能進下一階段；結算時一張票 1 點威望，
 * 威望最高的人拿「當選會長助理」+200 勢力（平票比勢力，再平比入場順序）。
 */
import { asPlayer, call, hostHeaders, makeChecker, openSession } from "./helpers.mjs";

const { check, ok, done } = makeChecker();

const { code: CODE, password: PW } = await openSession();
console.log(`使用場次 ${CODE}`);
const host = hostHeaders(PW);

const ROSTER = [
  ["zhouqian", "阿謙"],
  ["shenshiyue", "月月"],
  ["chenjiashu", "小樹"],
  ["liwanxu", "婉序"],
];
const players = [];
for (const [characterId, nickname] of ROSTER) {
  const r = await call(`/${CODE}/join`, { method: "POST", body: { characterId, nickname } });
  players.push(r.json.player);
}
const [a, b, c, d] = players;

// ---- 投票只在第一週開放 ----
const tooEarly = await call(`/${CODE}/votes`, {
  method: "POST",
  headers: asPlayer(a),
  body: { targetId: b.id, kind: "approve" },
});
ok("第一週前不能投票", tooEarly.status >= 400, JSON.stringify(tooEarly.json));

await call(`/${CODE}/stage`, { method: "POST", headers: host, body: { stageId: "week1" } });

// ---- 玩家看得到自己剩幾張 ----
const mine = await call(`/${CODE}/state`, { headers: asPlayer(a) });
check("初始同意票", mine.json.me.votesLeft.approve, 2);
check("初始不同意票", mine.json.me.votesLeft.oppose, 1);
check("還沒投過任何人", mine.json.me.votedTargetIds, []);

// ---- 不能投自己 ----
const self = await call(`/${CODE}/votes`, {
  method: "POST",
  headers: asPlayer(a),
  body: { targetId: a.id, kind: "approve" },
});
ok("不能投自己", self.status >= 400, JSON.stringify(self.json));

// ---- 正常投一票 ----
const first = await call(`/${CODE}/votes`, {
  method: "POST",
  headers: asPlayer(a),
  body: { targetId: b.id, kind: "approve" },
});
check("投完剩 1 張同意", first.json.approveLeft, 1);
check("不同意票沒被動到", first.json.opposeLeft, 1);

// ---- 同一個人不能投第二次，連換票種也不行 ----
const again = await call(`/${CODE}/votes`, {
  method: "POST",
  headers: asPlayer(a),
  body: { targetId: b.id, kind: "approve" },
});
ok("同一人不能投兩次", again.status >= 400, JSON.stringify(again.json));

const switched = await call(`/${CODE}/votes`, {
  method: "POST",
  headers: asPlayer(a),
  body: { targetId: b.id, kind: "oppose" },
});
ok("投過同意就不能再投不同意", switched.status >= 400, JSON.stringify(switched.json));

// ---- 票種用完就不能再投 ----
await call(`/${CODE}/votes`, {
  method: "POST",
  headers: asPlayer(a),
  body: { targetId: c.id, kind: "approve" },
});
const overApprove = await call(`/${CODE}/votes`, {
  method: "POST",
  headers: asPlayer(a),
  body: { targetId: d.id, kind: "approve" },
});
ok("同意票用完就不能再投", overApprove.status >= 400, JSON.stringify(overApprove.json));

await call(`/${CODE}/votes`, {
  method: "POST",
  headers: asPlayer(a),
  body: { targetId: d.id, kind: "oppose" },
});
const aState = await call(`/${CODE}/state`, { headers: asPlayer(a) });
check("三張都投完", aState.json.me.votesLeft, { approve: 0, oppose: 0 });
check(
  "投過的人都記下來了",
  [...aState.json.me.votedTargetIds].sort(),
  [b.id, c.id, d.id].sort(),
);

// ---- 玩家看不到別人的票 ----
const dump = JSON.stringify(aState.json);
ok("玩家端沒有 voteProgress", !dump.includes("voteProgress"), dump.slice(0, 200));
const peerLog = await call(`/${CODE}/state`, { headers: asPlayer(b) });
ok(
  "動態看不到別人投給誰",
  !JSON.stringify(peerLog.json.log ?? []).includes("投給"),
  JSON.stringify(peerLog.json.log ?? []).slice(0, 300),
);

// ---- 主持人看得到進度，但拿不到票型 ----
const hostState = await call(`/${CODE}/state`, { headers: host });
const progress = Object.fromEntries(
  hostState.json.voteProgress.map((v) => [v.playerName, v.totalLeft]),
);
check("阿謙已投完", progress["周謙"], 0);
check("月月還有 3 張", progress["沈識月"], 3);
check("還沒全部投完", hostState.json.allVotesCast, false);
ok(
  "進度裡不含票型",
  hostState.json.voteProgress.every(
    (v) => !("targetId" in v) && !("kind" in v) && !("votes" in v),
  ),
  JSON.stringify(hostState.json.voteProgress).slice(0, 300),
);
ok(
  "但主持人的紀錄看得到票型",
  hostState.json.log.some((e) => e.type === "vote" && e.reason.includes("投給")),
  JSON.stringify(hostState.json.log.filter((e) => e.type === "vote")).slice(0, 300),
);

// ---- 沒投完不能進下一階段 ----
const blocked = await call(`/${CODE}/stage`, {
  method: "POST",
  headers: host,
  body: { stageId: "week2" },
});
ok("沒投完擋下換階段", blocked.status >= 400, JSON.stringify(blocked.json));
ok(
  "訊息指出還有誰沒投",
  String(blocked.json.message ?? "").includes("沒投完票"),
  JSON.stringify(blocked.json),
);

// ---- 讓其餘三人投完，票型刻意設計成結果可預測 ----
// 目標票數：小樹 同意3、月月 同意1+不同意1、婉序 不同意2、阿謙 同意1+不同意1
await call(`/${CODE}/votes`, { method: "POST", headers: asPlayer(b), body: { targetId: c.id, kind: "approve" } });
await call(`/${CODE}/votes`, { method: "POST", headers: asPlayer(b), body: { targetId: a.id, kind: "approve" } });
await call(`/${CODE}/votes`, { method: "POST", headers: asPlayer(b), body: { targetId: d.id, kind: "oppose" } });

await call(`/${CODE}/votes`, { method: "POST", headers: asPlayer(c), body: { targetId: b.id, kind: "approve" } });
await call(`/${CODE}/votes`, { method: "POST", headers: asPlayer(c), body: { targetId: d.id, kind: "approve" } });
await call(`/${CODE}/votes`, { method: "POST", headers: asPlayer(c), body: { targetId: a.id, kind: "oppose" } });

await call(`/${CODE}/votes`, { method: "POST", headers: asPlayer(d), body: { targetId: c.id, kind: "approve" } });
await call(`/${CODE}/votes`, { method: "POST", headers: asPlayer(d), body: { targetId: a.id, kind: "approve" } });
await call(`/${CODE}/votes`, { method: "POST", headers: asPlayer(d), body: { targetId: b.id, kind: "oppose" } });

const ready = await call(`/${CODE}/state`, { headers: host });
check("全部投完", ready.json.allVotesCast, true);

const before = Object.fromEntries(ready.json.players.map((p) => [p.name, { ...p }]));
check("結算前威望都是 10", [...new Set(ready.json.players.map((p) => p.prestige))], [10]);

// ---- 進第二週，自動結算 ----
const advance = await call(`/${CODE}/stage`, {
  method: "POST",
  headers: host,
  body: { stageId: "week2" },
});
ok("投完就能換階段", advance.status === 200, JSON.stringify(advance.json));

const after = await call(`/${CODE}/state`, { headers: host });
const now = Object.fromEntries(after.json.players.map((p) => [p.name, p]));

// 票數統計（每張票 1 點）：
//   周謙   同意 沈識月+李婉序 = 2，不同意 陳嘉樹 = 1 → +1
//   沈識月 同意 周謙+陳嘉樹 = 2，不同意 李婉序 = 1   → +1
//   陳嘉樹 同意 周謙+沈識月+李婉序 = 3，不同意 0     → +3
//   李婉序 同意 陳嘉樹 = 1，不同意 周謙+沈識月 = 2   → −1
check("周謙 威望 10 → 11", now["周謙"].prestige, 11);
check("沈識月 威望 10 → 11", now["沈識月"].prestige, 11);
check("陳嘉樹 威望 10 → 13", now["陳嘉樹"].prestige, 13);
check("李婉序 威望 10 → 9", now["李婉序"].prestige, 9);

// 陳嘉樹威望最高 → 當選會長助理 +200 勢力
check(
  "會長助理拿到 +200 勢力",
  now["陳嘉樹"].power - before["陳嘉樹"].power,
  200,
);
for (const name of ["周謙", "沈識月", "李婉序"]) {
  check(`${name} 沒拿到助理獎勵`, now[name].power - before[name].power, 0);
}

ok(
  "紀錄裡有當選會長助理",
  after.json.log.some((e) => e.reason === "當選會長助理" && e.playerName === "陳嘉樹"),
  JSON.stringify(after.json.log.filter((e) => e.type === "vote")).slice(0, 400),
);

// ---- 結算後的威望變動玩家只看得到自己的 ----
const winnerView = await call(`/${CODE}/state`, { headers: asPlayer(c) });
ok(
  "當事人看得到自己的票選結果",
  winnerView.json.log.some((e) => e.type === "vote" && e.resource === "威望值"),
  JSON.stringify(winnerView.json.log).slice(0, 300),
);
const otherView = await call(`/${CODE}/state`, { headers: asPlayer(a) });
ok(
  "看不到別人的票選結果",
  !otherView.json.log.some((e) => e.playerId !== a.id && e.resource === "威望值"),
  JSON.stringify(otherView.json.log).slice(0, 300),
);

// ---- 第二週就不能再投票了 ----
const late = await call(`/${CODE}/votes`, {
  method: "POST",
  headers: asPlayer(a),
  body: { targetId: b.id, kind: "approve" },
});
ok("第二週不能再投票", late.status >= 400, JSON.stringify(late.json));

// ---- 平票時比勢力 ----
{
  const { code, password } = await openSession();
  const h = hostHeaders(password);
  const ps = [];
  for (const [characterId, nickname] of [
    ["zhouqian", "甲"],
    ["shenshiyue", "乙"],
    ["chenjiashu", "丙"],
    ["liwanxu", "丁"],
  ]) {
    ps.push((await call(`/${code}/join`, { method: "POST", body: { characterId, nickname } })).json.player);
  }
  await call(`/${code}/stage`, { method: "POST", headers: h, body: { stageId: "week1" } });

  // 先讓乙的勢力值比較高
  await call(`/${code}/grant`, {
    method: "POST",
    headers: h,
    body: { playerIds: [ps[1].id], resource: "power", delta: 500 },
  });

  // 甲乙各拿 2 同意 1 不同意 → 威望同分
  const cast = (voter, target, kind) =>
    call(`/${code}/votes`, { method: "POST", headers: asPlayer(voter), body: { targetId: target.id, kind } });
  // 每人 2 同意 1 不同意，四人互投。甲乙各收 3 張同意 → 同分 13
  await cast(ps[0], ps[1], "approve");
  await cast(ps[0], ps[2], "approve");
  await cast(ps[0], ps[3], "oppose");
  await cast(ps[1], ps[0], "approve");
  await cast(ps[1], ps[2], "approve");
  await cast(ps[1], ps[3], "oppose");
  await cast(ps[2], ps[0], "approve");
  await cast(ps[2], ps[1], "approve");
  await cast(ps[2], ps[3], "oppose");
  await cast(ps[3], ps[0], "approve");
  await cast(ps[3], ps[1], "approve");
  await cast(ps[3], ps[2], "oppose");

  const readyTie = await call(`/${code}/state`, { headers: h });
  check("平票場也全部投完", readyTie.json.allVotesCast, true);

  const beforeTie = Object.fromEntries(
    readyTie.json.players.map((p) => [p.name, { ...p }]),
  );
  const moveTie = await call(`/${code}/stage`, {
    method: "POST",
    headers: h,
    body: { stageId: "week2" },
  });
  ok("平票場換階段成功", moveTie.status === 200, JSON.stringify(moveTie.json));
  const afterTie = Object.fromEntries(
    (await call(`/${code}/state`, { headers: h })).json.players.map((p) => [p.name, p]),
  );

  check("甲乙威望同分", afterTie["周謙"].prestige, afterTie["沈識月"].prestige);
  check("而且是最高分", afterTie["周謙"].prestige, 13);
  check(
    "平票由勢力較高的沈識月當選",
    afterTie["沈識月"].power - beforeTie["沈識月"].power,
    200,
  );
  check("周謙沒拿到", afterTie["周謙"].power - beforeTie["周謙"].power, 0);
}

// ---- 人數不足時票數自動下修，閘門才不會卡死 ----
{
  const { code, password } = await openSession();
  const h = hostHeaders(password);
  const ps = [];
  for (const [characterId, nickname] of [["zhouqian", "甲"], ["shenshiyue", "乙"], ["chenjiashu", "丙"]]) {
    ps.push((await call(`/${code}/join`, { method: "POST", body: { characterId, nickname } })).json.player);
  }
  await call(`/${code}/stage`, { method: "POST", headers: h, body: { stageId: "week1" } });

  const st = await call(`/${code}/state`, { headers: asPlayer(ps[0]) });
  check("三人場只能投 2 張同意", st.json.me.votesLeft.approve, 2);
  check("三人場沒有不同意票可投", st.json.me.votesLeft.oppose, 0);

  for (const voter of ps) {
    for (const target of ps.filter((x) => x.id !== voter.id)) {
      await call(`/${code}/votes`, {
        method: "POST",
        headers: asPlayer(voter),
        body: { targetId: target.id, kind: "approve" },
      });
    }
  }
  const done3 = await call(`/${code}/state`, { headers: h });
  check("三人都投完", done3.json.allVotesCast, true);

  const move = await call(`/${code}/stage`, { method: "POST", headers: h, body: { stageId: "week2" } });
  ok("三人場也能進下一階段", move.status === 200, JSON.stringify(move.json));
}

done("競選投票測試");
