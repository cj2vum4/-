/**
 * 場次結束後的個人回顧測試。需要記憶體模式的伺服器，見 README。
 *
 * 場次一封存，工作分頁就刪了，資料只剩彙整分頁。這支驗的是「從那裡讀回來」
 * 這條路徑：玩家用原本的身分還能看到自己的成績、聘書與紀錄。
 */
import { asPlayer, call, castAllVotes, hostHeaders, makeChecker, openSession }
  from "./helpers.mjs";

const { check, ok, done } = makeChecker();

const { code: CODE, password: PW } = await openSession("回顧測試場");
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

// 走完一輪，留下夠多的紀錄
await call(`/${CODE}/stage`, { method: "POST", headers: host, body: { stageId: "week1" } });
await call(`/${CODE}/grant`, {
  method: "POST",
  headers: host,
  body: { playerIds: [me.id], resource: "power", delta: 1234, reason: "開啟九爺金庫的寶箱" },
});
await castAllVotes(CODE, players);
await call(`/${CODE}/stage`, { method: "POST", headers: host, body: { stageId: "final" } });
await call(`/${CODE}/grant`, {
  method: "POST",
  headers: host,
  body: { playerIds: [other.id], resource: "power", delta: 50, reason: "只有月月才有的事由" },
});
await call(`/${CODE}/grant`, {
  method: "POST",
  headers: host,
  body: { playerIds: [third.id], resource: "power", delta: 20 },
});
const issued = await call(`/${CODE}/certificates`, { method: "POST", headers: host });
check("聘書發放", issued.json.issued, 3);

const beforeClose = await call(`/${CODE}/state`, { headers: asPlayer(me) });
const powerBefore = beforeClose.json.me.power;
const prestigeBefore = beforeClose.json.me.prestige;

// ---- 結束並封存 ----
const closed = await call(`/${CODE}/status`, {
  method: "POST",
  headers: host,
  body: { status: "closed" },
});
check("已封存", closed.json.session.archived, true);

// ---- 一般的即時狀態已經沒東西了，這正是需要回顧的原因 ----
const liveAfter = await call(`/${CODE}/state`, { headers: asPlayer(me) });
ok("封存後拿不到即時狀態", liveAfter.status >= 400, `HTTP ${liveAfter.status}`);

// ---- 回顧讀得到 ----
const review = await call(`/${CODE}/review`, { headers: asPlayer(me) });
ok("回顧讀得到", review.status === 200, JSON.stringify(review.json).slice(0, 200));
check("角色對得上", review.json.me.name, "周謙");
check("暱稱還在", review.json.me.nickname, "阿謙");
check("最終勢力值保留", review.json.me.power, powerBefore);
check("最終威望值保留", review.json.me.prestige, prestigeBefore);
check("場次名稱", review.json.session.title, "回顧測試場");
check("最終階段", review.json.session.finalStage.includes("會長就任結算"), true);

// 聘書
ok("聘書讀得回來", Boolean(review.json.me.certificate), JSON.stringify(review.json.me));
check("聘書名次", review.json.me.certificate.rank, 1);
check("聘書職位", review.json.me.certificate.position, "會長");
check("聘書稱號", review.json.me.certificate.title, "南洋最強贏麻了");

// 自己的紀錄
ok("看得到自己的紀錄", review.json.log.length > 0, JSON.stringify(review.json.log).slice(0, 200));
ok(
  "含主持人發的寶箱",
  review.json.log.some((e) => e.reason === "開啟九爺金庫的寶箱" && e.delta === 1234),
  JSON.stringify(review.json.log).slice(0, 400),
);
// 自己的投票紀錄會寫出投給誰，所以不能用「有沒有出現別人名字」來判斷。
// 改用一筆只有對方才有的事由：那一筆絕對不能出現在我的紀錄裡。
ok(
  "紀錄裡沒有別人的異動",
  !review.json.log.some((e) => e.reason === "只有月月才有的事由"),
  JSON.stringify(review.json.log).slice(0, 400),
);

ok(
  "不含來源類型",
  review.json.log.every((e) => !("source" in e)),
  JSON.stringify(review.json.log[0]),
);

// ---- 別人看到的是自己那一份 ----
const otherReview = await call(`/${CODE}/review`, { headers: asPlayer(other) });
check("另一位玩家看到自己的", otherReview.json.me.name, "沈識月");
ok(
  "而且看得到只有他才有的那一筆",
  otherReview.json.log.some((e) => e.reason === "只有月月才有的事由"),
  JSON.stringify(otherReview.json.log).slice(0, 400),
);
ok(
  "拿不到別人的勢力值",
  otherReview.json.me.power !== review.json.me.power,
  `${otherReview.json.me.power} vs ${review.json.me.power}`,
);

// ---- 認證 ----
const badCode = await call(`/${CODE}/review`, {
  headers: { "x-player-id": me.id, "x-join-code": "0000" },
});
ok("通行碼不對拿不到", badCode.status >= 400, `HTTP ${badCode.status}`);
const anon = await call(`/${CODE}/review`);
ok("沒有身分拿不到", anon.status >= 400, `HTTP ${anon.status}`);

// ---- 故事復盤在封存後仍然看得到 ----
const story = await call(`/${CODE}/story`, { headers: asPlayer(me) });
ok("封存後仍看得到故事復盤", story.status === 200, JSON.stringify(story.json).slice(0, 200));
const storyAnon = await call(`/${CODE}/story`, {
  headers: { "x-player-id": me.id, "x-join-code": "0000" },
});
ok("通行碼不對看不到復盤", storyAnon.status >= 400, `HTTP ${storyAnon.status}`);

// ---- 密碼還找得到這一場（散場後回來用的） ----
const look = await call("/lookup", { method: "POST", body: { password: PW } });
check("密碼仍找得到場次", look.json.session.code, CODE);
check("而且標記為已結束", look.json.session.archived, true);

// ---- 但同一組密碼開新場時，要進到新的那一場 ----
const fresh = await call("", { method: "POST", body: { password: PW, title: "新的一場" } });
ok("同一組密碼可以再開新場", fresh.status === 200, JSON.stringify(fresh.json));
const lookAgain = await call("/lookup", { method: "POST", body: { password: PW } });
check("密碼指向新的場次", lookAgain.json.session.code, fresh.json.session.code);
check("新場次不是封存的", lookAgain.json.session.archived, false);

// 舊場次的回顧照樣讀得到
const stillThere = await call(`/${CODE}/review`, { headers: asPlayer(me) });
ok("舊場次的回顧仍然讀得到", stillThere.status === 200, `HTTP ${stillThere.status}`);

// ---- 舊格式的封存（沒有「通行碼」欄）也要讀得回來 ----
// 正式試算表裡就有這種資料——通行碼是後來才補的欄位。
// 解析改成依欄位名取值之後，缺欄位只會少那一個值，不會整排錯開。
{
  const { code, password } = await openSession("舊格式測試");
  const h = hostHeaders(password);
  const ps = [];
  for (const [characterId, nickname] of [["zhouqian", "甲"], ["shenshiyue", "乙"]]) {
    ps.push((await call(`/${code}/join`, { method: "POST", body: { characterId, nickname } })).json.player);
  }
  await call(`/${code}/grant`, {
    method: "POST",
    headers: h,
    body: { playerIds: [ps[0].id], resource: "power", delta: 321, reason: "舊格式的紀錄" },
  });
  await call(`/${code}/status`, { method: "POST", headers: h, body: { status: "closed" } });

  // 正常讀得到
  const normal = await call(`/${code}/review`, { headers: asPlayer(ps[0]) });
  ok("新格式讀得到", normal.status === 200, JSON.stringify(normal.json).slice(0, 200));
  check("新格式的勢力值", normal.json.me.power, 321);
  ok(
    "新格式帶通行碼時，通行碼錯就讀不到",
    (await call(`/${code}/review`, {
      headers: { "x-player-id": ps[0].id, "x-join-code": "0000" },
    })).status >= 400,
    "應該被擋",
  );
}

done("場次回顧測試");
