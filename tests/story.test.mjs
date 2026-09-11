/**
 * 故事復盤的存取控制測試。需要記憶體模式的伺服器，見 README。
 *
 * 復盤把全場陣營與所有真相攤開，所以只給已入場的玩家，而且只在聘書發放後。
 */
import { asPlayer, call, hostHeaders, makeChecker, openSession } from "./helpers.mjs";

const { check, ok, done } = makeChecker();

const { code: CODE, password: PW } = await openSession();
console.log(`使用場次 ${CODE}`);
const host = hostHeaders(PW);

const players = [];
for (const [characterId, nickname] of [["zhouqian", "阿謙"], ["shenshiyue", "月月"]]) {
  const r = await call(`/${CODE}/join`, { method: "POST", body: { characterId, nickname } });
  players.push(r.json.player);
}
const [me, other] = players;

// ---- 聘書發放前，誰都拿不到 ----
const early = await call(`/${CODE}/story`, { headers: asPlayer(me) });
ok("發聘書前拿不到復盤", early.status >= 400, `HTTP ${early.status}`);
ok(
  "訊息說明要等聘書",
  String(early.json.message ?? "").includes("聘書"),
  JSON.stringify(early.json),
);
ok(
  "擋下時不夾帶任何內容",
  !JSON.stringify(early.json).includes("小鯉"),
  JSON.stringify(early.json).slice(0, 300),
);

// ---- 沒入場的人拿不到 ----
const anon = await call(`/${CODE}/story`);
ok("沒有身分拿不到", anon.status >= 400, `HTTP ${anon.status}`);

const faked = await call(`/${CODE}/story`, {
  headers: { "x-player-id": me.id, "x-join-code": "0000" },
});
ok("通行碼不對拿不到", faked.status >= 400, `HTTP ${faked.status}`);

// ---- 發聘書 ----
await call(`/${CODE}/stage`, { method: "POST", headers: host, body: { stageId: "final" } });
await call(`/${CODE}/grant`, {
  method: "POST",
  headers: host,
  body: { playerIds: [me.id], resource: "power", delta: 5000 },
});
await call(`/${CODE}/grant`, {
  method: "POST",
  headers: host,
  body: { playerIds: [other.id], resource: "power", delta: 1000 },
});
const issued = await call(`/${CODE}/certificates`, { method: "POST", headers: host });
check("聘書發放成功", issued.json.issued, 2);

// ---- 發放後兩個人都看得到 ----
const story = await call(`/${CODE}/story`, { headers: asPlayer(me) });
ok("發聘書後拿得到復盤", story.status === 200, JSON.stringify(story.json).slice(0, 200));

const otherStory = await call(`/${CODE}/story`, { headers: asPlayer(other) });
ok("另一個玩家也拿得到", otherStory.status === 200, `HTTP ${otherStory.status}`);

// ---- 內容完整性 ----
const d = story.json;
check("標題", d.title, "陣營部分復盤");
check("章節數", d.chapters.length, 4);
check(
  "章節名稱",
  d.chapters.map((c) => c.title),
  ["商會的由來", "角色身份", "兩座金庫", "事件復盤"],
);

const identities = d.chapters.find((c) => c.id === "identities");
check("七個角色的身份都在", identities.blocks.length, 7);
check(
  "每一段都掛上角色代碼",
  identities.blocks.every((b) => b.characterId),
  true,
);
check(
  "陣營對得上劇本",
  identities.blocks.map((b) => `${b.characterId}:${b.heading.split("　")[1]}`),
  [
    "zhouqian:九爺陣營",
    "shenshiyue:九爺陣營",
    "jixiuyuan:九爺陣營",
    "chenjiashu:紅姑娘陣營",
    "liwanxu:紅姑娘陣營",
    "shangyu:紅姑娘陣營",
    "lubingbai:廟街鬼老的第三方陣營",
  ],
);

const dump = JSON.stringify(d);
for (const [label, word] of [
  ["陸秉白的真名", "陸無病"],
  ["商羽的三層身份", "小鯉"],
  ["夜鴉的真身", "王福生"],
  ["季修遠的真實身份", "熙則"],
  ["金庫鑰匙的真假", "蒼蒼橫翠微"],
  ["結局", "汽車爆炸"],
]) {
  ok(`內容包含${label}`, dump.includes(word), word);
}

ok("有下一部的預告", String(d.epilogue ?? "").includes("下一部作品"), d.epilogue);

// 每個段落都要有字，不能有空殼
const emptyBlocks = d.chapters.flatMap((c) =>
  c.blocks.filter((b) => !b.paragraphs?.length || b.paragraphs.some((t) => !t.trim())),
);
check("沒有空段落", emptyBlocks.length, 0);

done("故事復盤測試");
