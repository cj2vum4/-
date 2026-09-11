/**
 * 動態（流水帳）的可見性測試。
 *
 * 需要記憶體模式的伺服器，見 README「需要伺服器的測試」。
 *
 * 核心規則：玩家在動態裡看不到「別人的數值變動」。
 * 威望值在榜單上是公開的，但動態出現「某某 威望值 −1」就等於公布他被舉報成立
 * 或被構陷；招募次數則等於把威望排名攤開。兩者都不該出現。
 */
import { asPlayer, call, castAllVotes, hostHeaders, makeChecker, openSession }
  from "./helpers.mjs";

const { check, ok, done } = makeChecker();

const { code: CODE, password: PW } = await openSession();
console.log(`使用場次 ${CODE}`);
const host = hostHeaders(PW);

const players = [];
for (const [characterId, nickname] of [
  ["zhouqian", "阿謙"],
  ["shenshiyue", "月月"],
  ["chenjiashu", "小樹"],
]) {
  const r = await call(`/${CODE}/join`, { method: "POST", body: { characterId, nickname } });
  players.push(r.json.player);
}
const [me, other, third] = players;

// ---- 製造各種會扣威望／發招募次數的事件 ----
await call(`/${CODE}/stage`, { method: "POST", headers: host, body: { stageId: "week1" } });

// 主持人扣別人威望
await call(`/${CODE}/grant`, {
  method: "POST",
  headers: host,
  body: { playerIds: [other.id], resource: "prestige", delta: -2, reason: "亂講話" },
});
// 主持人加別人威望
await call(`/${CODE}/grant`, {
  method: "POST",
  headers: host,
  body: { playerIds: [third.id], resource: "prestige", delta: 3, reason: "投票獎勵" },
});

// 舉報：小樹舉報月月，用的是不在 21 張名單中的編號 → 受理，結算時扣舉報人威望
// （拿真卡指錯人現在是當場退回，不會留下紀錄，所以這裡不能用真卡）
await call(`/${CODE}/reports`, {
  method: "POST",
  headers: asPlayer(third),
  body: { targetId: other.id, clueCode: "ZZ9" },
});

// 切到第二週：結算舉報 + 依威望排名發招募次數
// 第一週結束前全場必須投完票，否則換不了階段
await castAllVotes(CODE, players);
await call(`/${CODE}/stage`, { method: "POST", headers: host, body: { stageId: "week2" } });

// 別人抽招募
await call(`/${CODE}/recruit/draw`, {
  method: "POST",
  headers: asPlayer(other),
  body: { times: 3 },
});

// ---- 主持人看得到全部，玩家看不到別人的 ----
const hostLog = (await call(`/${CODE}/state`, { headers: host })).json.log;
ok("主持台看得到威望變動", hostLog.some((e) => e.resource === "威望值"), "主持台應保留完整帳");
ok("主持台看得到招募次數", hostLog.some((e) => e.type === "recruit"), "主持台應保留完整帳");

const myLog = (await call(`/${CODE}/state`, { headers: asPlayer(me) })).json.log;

// 核心斷言：動態裡不能有任何「別人的數值變動」
const peerWithResource = myLog.filter((e) => e.playerId && e.playerId !== me.id && e.resource);
check("動態沒有別人的數值變動", peerWithResource, []);

const peerRecruit = myLog.filter((e) => e.playerId && e.playerId !== me.id && e.type === "recruit");
check("動態沒有別人的招募次數", peerRecruit, []);

// 投票紀錄：自己投給誰看得到（那是自己的行為），別人投給誰一概看不到
ok(
  "看得到自己投給誰",
  myLog.some((e) => e.type === "vote" && e.playerId === me.id && e.reason.includes("投給")),
  JSON.stringify(myLog.filter((e) => e.type === "vote")).slice(0, 300),
);
check(
  "看不到別人的投票紀錄",
  myLog.filter((e) => e.type === "vote" && e.playerId && e.playerId !== me.id),
  [],
);

// ---- 自己的紀錄還是看得到，不然玩家不知道自己發生什麼事 ----
await call(`/${CODE}/grant`, {
  method: "POST",
  headers: host,
  body: { playerIds: [me.id], resource: "prestige", delta: -1, reason: "自己的懲罰" },
});
const mineAfter = (await call(`/${CODE}/state`, { headers: asPlayer(me) })).json.log;
ok(
  "自己的威望變動看得到",
  mineAfter.some((e) => e.playerId === me.id && e.resource === "威望值" && e.delta === -1),
  JSON.stringify(mineAfter).slice(0, 400),
);
ok(
  "自己的招募次數看得到",
  mineAfter.some((e) => e.playerId === me.id && e.type === "recruit"),
  JSON.stringify(mineAfter).slice(0, 400),
);

// ---- 當事人必須看得到自己被扣的那一筆 ----
// 「構陷」扣的是目標的威望，被陰的人要知道自己被扣了，只是不知道是誰做的
const victim = other;
const attacker = third;
const beforeVictim = (await call(`/${CODE}/state`, { headers: asPlayer(victim) })).json.me.prestige;

// 讓 attacker 手上一定有構陷卡：直接抽到有為止（彩池有限，抽完就算了）
let framed = false;
for (let i = 0; i < 8 && !framed; i++) {
  const st = (await call(`/${CODE}/state`, { headers: asPlayer(attacker) })).json;
  if (st.me.drawsRemaining <= 0) break;
  await call(`/${CODE}/recruit/draw`, {
    method: "POST",
    headers: asPlayer(attacker),
    body: { times: 1 },
  });
  const after = (await call(`/${CODE}/state`, { headers: asPlayer(attacker) })).json;
  if (after.me.heldCards.includes("w2_steal_prestige")) framed = true;
}

if (framed) {
  const used = await call(`/${CODE}/recruit/use-card`, {
    method: "POST",
    headers: asPlayer(attacker),
    body: { cardId: "w2_steal_prestige", targetId: victim.id },
  });
  ok("構陷成功送出", used.status === 200, JSON.stringify(used.json));

  const victimLog = (await call(`/${CODE}/state`, { headers: asPlayer(victim) })).json.log;
  ok(
    "被構陷的人看得到自己被扣威望",
    victimLog.some((e) => e.type === "skill" && e.playerId === victim.id && e.resource === "威望值"),
    JSON.stringify(victimLog).slice(0, 400),
  );
  check(
    "被構陷的人威望確實少了",
    (await call(`/${CODE}/state`, { headers: asPlayer(victim) })).json.me.prestige,
    beforeVictim - 1,
  );

  // 第三人不該看到這件事
  const bystanderLog = (await call(`/${CODE}/state`, { headers: asPlayer(me) })).json.log;
  ok(
    "旁人看不到別人被構陷",
    !bystanderLog.some((e) => e.playerId === victim.id && e.resource === "威望值"),
    JSON.stringify(bystanderLog).slice(0, 400),
  );
} else {
  console.log("  SKIP  這輪沒抽到構陷卡，跳過技能卡可見性檢查");
}

// 舉報結算：輸的那個人（這裡是舉報失敗的 third）要看得到自己被扣
const reporterLog = (await call(`/${CODE}/state`, { headers: asPlayer(third) })).json.log;
ok(
  "舉報失敗的人看得到自己被扣威望",
  reporterLog.some((e) => e.type === "report" && e.playerId === third.id && e.delta === -1),
  JSON.stringify(reporterLog).slice(0, 400),
);
// 結算那一筆事由必須留白——「只顯示數字的結果」。
// 「提出舉報」「遭到舉報」那兩筆有事由是對的，那是本人自己的行為。
ok(
  "結算那筆不揭露明細",
  reporterLog
    .filter((e) => e.type === "report" && e.playerId === third.id && e.delta === -1)
    .every((e) => !e.reason && !e.source),
  JSON.stringify(
    reporterLog.filter((e) => e.type === "report" && e.delta === -1),
  ).slice(0, 400),
);

// ---- 場次層級與現場本來就看得見的事件仍保留 ----
ok("看得到換階段", mineAfter.some((e) => e.type === "stage"), "階段變化應該公開");
ok("看得到別人入場", mineAfter.some((e) => e.type === "join" && e.playerId !== me.id), "入場是公開的");

done("動態可見性測試");
