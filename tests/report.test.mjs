/**
 * 舉報判定測試。需要記憶體模式的伺服器，見 README。
 *
 * 判定規則（「指向別人」與「不在名單中」是兩種不同的待遇）：
 *   21 張之一，且指向被舉報人 → 成立，結算時扣被舉報人 1 威望
 *   21 張之一，但指向別人     → 「您輸入錯誤」，不受理也不留紀錄
 *   不在 21 張之中            → 受理，結算時扣舉報人 1 威望
 */
import { asPlayer, call, castAllVotes, hostHeaders, makeChecker, openSession }
  from "./helpers.mjs";

const { check, ok, done } = makeChecker();

const { code: CODE, password: PW } = await openSession();
console.log(`使用場次 ${CODE}`);
const host = hostHeaders(PW);

// 0A6 是周謙的線索卡，5B6 是陳嘉樹的
const players = [];
for (const [characterId, nickname] of [
  ["zhouqian", "阿謙"],
  ["shenshiyue", "月月"],
  ["chenjiashu", "小樹"],
]) {
  const r = await call(`/${CODE}/join`, { method: "POST", body: { characterId, nickname } });
  players.push(r.json.player);
}
const [zhou, shen, chen] = players;

await call(`/${CODE}/stage`, { method: "POST", headers: host, body: { stageId: "week1" } });

// ---- 拿真卡指錯人 → 當場退回，不留紀錄 ----
const wrongTarget = await call(`/${CODE}/reports`, {
  method: "POST",
  headers: asPlayer(shen),
  body: { targetId: chen.id, clueCode: "0A6" },
});
ok("真卡指錯人被退回", wrongTarget.status >= 400, JSON.stringify(wrongTarget.json));
check("訊息是「您輸入錯誤」", wrongTarget.json.message, "您輸入錯誤");

const afterWrong = await call(`/${CODE}/state`, { headers: host });
check("退回的不留紀錄", afterWrong.json.reports.length, 0);

// 同一張卡改對象就能送出，代表真的沒被佔用
const corrected = await call(`/${CODE}/reports`, {
  method: "POST",
  headers: asPlayer(shen),
  body: { targetId: zhou.id, clueCode: "0A6" },
});
ok("改對正確對象就能送出", corrected.status === 200, JSON.stringify(corrected.json));

// ---- 不在名單中的編號 → 受理 ----
const bogus = await call(`/${CODE}/reports`, {
  method: "POST",
  headers: asPlayer(chen),
  body: { targetId: zhou.id, clueCode: "ZZ9" },
});
ok("名單外的編號照樣送出", bogus.status === 200, JSON.stringify(bogus.json));

// 同一串編造的編號不該被當成「已被使用」——那會洩漏有人送過
const bogusAgain = await call(`/${CODE}/reports`, {
  method: "POST",
  headers: asPlayer(shen),
  body: { targetId: chen.id, clueCode: "ZZ9" },
});
ok("別人送同一串編造編號也能送出", bogusAgain.status === 200, JSON.stringify(bogusAgain.json));

// ---- 真卡單次使用仍然有效 ----
const reuse = await call(`/${CODE}/reports`, {
  method: "POST",
  headers: asPlayer(chen),
  body: { targetId: zhou.id, clueCode: "0A6" },
});
ok("真卡不能重複使用", reuse.status >= 400, JSON.stringify(reuse.json));
check("訊息是已被使用", reuse.json.message, "此線索卡已被使用");

// ---- 結算 ----
const before = Object.fromEntries(
  (await call(`/${CODE}/state`, { headers: host })).json.players.map((p) => [p.name, p.prestige]),
);
await castAllVotes(CODE, players);
await call(`/${CODE}/stage`, { method: "POST", headers: host, body: { stageId: "week2" } });
const after = Object.fromEntries(
  (await call(`/${CODE}/state`, { headers: host })).json.players.map((p) => [p.name, p.prestige]),
);

// 投票也會動威望，所以用「舉報造成的那幾筆」來驗，避免兩種效果混在一起
const log = (await call(`/${CODE}/state`, { headers: host })).json.log;
const penalties = log.filter((e) => e.type === "report" && e.delta === -1);
check("三筆懲罰", penalties.length, 3);

const byName = {};
for (const e of penalties) byName[e.playerName] = (byName[e.playerName] ?? 0) + 1;
check("周謙被扣 1 次（舉報成立）", byName["周謙"], 1);
check("陳嘉樹被扣 1 次（編造編號）", byName["陳嘉樹"], 1);
check("沈識月被扣 1 次（編造編號）", byName["沈識月"], 1);

ok("結算後威望確實下降", after["周謙"] < before["周謙"] + 3, `${before["周謙"]} → ${after["周謙"]}`);

// ---- 舉報成立後線索卡對全場公開 ----
const revealed = (await call(`/${CODE}/state`, { headers: asPlayer(shen) })).json.revealedClues;
ok(
  "成立的線索卡公開了",
  revealed.some((c) => c.code === "0A6" && c.ownerName === "周謙"),
  JSON.stringify(revealed),
);
ok(
  "編造的編號不會被公開",
  !revealed.some((c) => c.code === "ZZ9"),
  JSON.stringify(revealed),
);

done("舉報判定測試");
