/**
 * 掉線回場測試。需要記憶體模式的伺服器，見 README。
 *
 * 玩家換手機、清了瀏覽器資料、或分頁被系統回收之後，角色已經被自己選走，
 * 沒有這個入口整場就回不去了。用入場時填的暱稱認回。
 */
import { asPlayer, call, hostHeaders, makeChecker, openSession } from "./helpers.mjs";

const { check, ok, done } = makeChecker();

const { code: CODE, password: PW } = await openSession();
console.log(`使用場次 ${CODE}`);
const host = hostHeaders(PW);

const joined = await call(`/${CODE}/join`, {
  method: "POST",
  body: { characterId: "zhouqian", nickname: "海星" },
});
const me = joined.json.player;
ok("先正常入場", joined.status === 200, JSON.stringify(joined.json));

// 累積一點數值，確認認回之後資料還在
await call(`/${CODE}/grant`, {
  method: "POST",
  headers: host,
  body: { playerIds: [me.id], resource: "power", delta: 777 },
});

// ---- 角色已經被選走，新入場會被擋 ----
const dup = await call(`/${CODE}/join`, {
  method: "POST",
  body: { characterId: "zhouqian", nickname: "冒充的" },
});
ok("同一個角色不能再被選一次", dup.status >= 400, JSON.stringify(dup.json));

// ---- 用暱稱認回 ----
const back = await call(`/${CODE}/rejoin`, {
  method: "POST",
  body: { characterId: "zhouqian", nickname: "海星" },
});
ok("暱稱正確就能認回", back.status === 200, JSON.stringify(back.json));
check("認回的是同一個玩家", back.json.player.id, me.id);
check("通行碼也拿得回來", back.json.player.joinCode, me.joinCode);

// 拿回來的身分要真的能用
const state = await call(`/${CODE}/state`, { headers: asPlayer(back.json.player) });
check("認回後資料都還在", state.json.me.power, 777);
check("暱稱沒變", state.json.me.nickname, "海星");

// ---- 暱稱比對的寬鬆度：大小寫與空白不計較 ----
const spaced = await call(`/${CODE}/rejoin`, {
  method: "POST",
  body: { characterId: "zhouqian", nickname: "  海星  " },
});
ok("前後空白不影響", spaced.status === 200, JSON.stringify(spaced.json));

const latin = await call(`/${CODE}/join`, {
  method: "POST",
  body: { characterId: "shenshiyue", nickname: "SeaStar" },
});
const latinPlayer = latin.json.player;
const caseless = await call(`/${CODE}/rejoin`, {
  method: "POST",
  body: { characterId: "shenshiyue", nickname: "seastar" },
});
ok("英文大小寫不影響", caseless.status === 200, JSON.stringify(caseless.json));
check("認回的是同一人", caseless.json.player.id, latinPlayer.id);

// ---- 暱稱錯就不給過，而且不能洩漏正確答案 ----
const wrong = await call(`/${CODE}/rejoin`, {
  method: "POST",
  body: { characterId: "zhouqian", nickname: "不是這個" },
});
ok("暱稱錯誤會擋下", wrong.status >= 400, JSON.stringify(wrong.json));
ok(
  "錯誤訊息不洩漏正確暱稱",
  !JSON.stringify(wrong.json).includes("海星"),
  JSON.stringify(wrong.json),
);

const empty = await call(`/${CODE}/rejoin`, {
  method: "POST",
  body: { characterId: "zhouqian", nickname: "   " },
});
ok("空白暱稱會擋下", empty.status >= 400, JSON.stringify(empty.json));

// ---- 沒人選的角色不該走認回 ----
const free = await call(`/${CODE}/rejoin`, {
  method: "POST",
  body: { characterId: "lubingbai", nickname: "海星" },
});
ok("沒人選的角色不能認回", free.status >= 400, JSON.stringify(free.json));
ok(
  "訊息告訴他直接選就好",
  String(free.json.message ?? "").includes("直接選"),
  JSON.stringify(free.json),
);

// ---- 遊戲進行到一半也要能認回，這正是最需要的時候 ----
await call(`/${CODE}/stage`, { method: "POST", headers: host, body: { stageId: "week3" } });
const midGame = await call(`/${CODE}/rejoin`, {
  method: "POST",
  body: { characterId: "zhouqian", nickname: "海星" },
});
ok("第三週掉線也能認回", midGame.status === 200, JSON.stringify(midGame.json));

// 但新玩家這時候仍然不能入場
const lateJoin = await call(`/${CODE}/join`, {
  method: "POST",
  body: { characterId: "chenjiashu", nickname: "遲到的" },
});
ok("新玩家這時候仍不能入場", lateJoin.status >= 400, JSON.stringify(lateJoin.json));

// ---- 場次結束後就不能認回了 ----
await call(`/${CODE}/status`, { method: "POST", headers: host, body: { status: "closed" } });
const afterClose = await call(`/${CODE}/rejoin`, {
  method: "POST",
  body: { characterId: "zhouqian", nickname: "海星" },
});
ok("封存後不能認回", afterClose.status >= 400, JSON.stringify(afterClose.json));

done("掉線回場測試");
