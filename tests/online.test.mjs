/**
 * 線上主持（瘋兔子／天才在左我在右）API 測試。
 *
 *   ONLINE_FENGTUZ_MOCK=1 npm run build && ONLINE_FENGTUZ_MOCK=1 npm start
 *   node tests/online.test.mjs
 *
 * 重點在「誰看得到什麼」：玩家只能拿到發給全體、發給自己、自己解鎖的線索，
 * 第二本劇本在開放前連標題都不能出現，圖片也要驗過身分才給。
 */
import { BASE, makeChecker } from "./helpers.mjs";

const { check, ok, done } = makeChecker();

async function call(path, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(`${BASE}/api/online${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const PIN = "test-pin";
const host = { "x-host-pin": PIN };
const as = (p) => ({ "x-role-id": p.roleId, "x-player-token": p.token });
const act = (code, body) => call(`/${code}/host`, { method: "POST", headers: host, body });
const state = async (code, p) => (await call(`/${code}/state`, { headers: as(p) })).json.player;

console.log("\n[天才在左我在右]");
const created = await call("", { method: "POST", body: { script: "tiancai", pin: PIN } });
const code = created.json.code;
ok("開場取得 TC- 代碼", /^TC-[A-Z0-9]{6}$/.test(code ?? ""), JSON.stringify(created.json));
check("密碼太短被擋", (await call("", { method: "POST", body: { script: "tiancai", pin: "1" } })).status, 400);
check("錯誤主持密碼被擋", (await call(`/${code}/state`, { headers: { "x-host-pin": "wrong" } })).status, 401);
check("匿名讀狀態被擋", (await call(`/${code}/state`)).status, 401);
check("匿名讀線索全集被擋", (await call(`/${code}/catalog`)).status, 401);

const lobby = (await call(`/${code}/lobby`)).json.lobby;
check("大廳有 7 個角色", lobby.roles.length, 7);
ok("大廳不含劇本內容", !JSON.stringify(lobby).includes("雍九"));

const join = async (roleId, nickname) =>
  (await call(`/${code}/join`, { method: "POST", body: { roleId, nickname } })).json.identity;
const a = await join("01", "阿明");
const b = await join("02", "阿華");
ok("兩位玩家入場", Boolean(a?.token && b?.token));
check(
  "別人選走的角色不能搶",
  (await call(`/${code}/join`, { method: "POST", body: { roleId: "01", nickname: "路人" } })).json.code,
  "ROLE_TAKEN",
);
const again = await join("01", "阿明");
check("同暱稱認回同一組憑證", again?.token, a.token);
check("假憑證被擋", (await call(`/${code}/state`, { headers: as({ roleId: "01", token: "x" }) })).status, 401);

let sa = await state(code, a);
check("開場前沒有任何線索", sa.clues.length, 0);
ok("開場前劇本全部鎖住", sa.docs.every((d) => d.body === null));
ok("第二本在開放前不存在", !sa.docs.some((d) => d.book === "第二本"));

await act(code, { action: "phase", phase: 2 });
sa = await state(code, a);
ok("切到第一幕後第一幕可讀", sa.docs.some((d) => d.title.startsWith("第一幕") && d.body));
ok("第二幕仍鎖住", sa.docs.some((d) => d.title.startsWith("第二幕") && d.body === null));

await act(code, { action: "release", clueId: "CHAR-低語者", to: "default" });
await act(code, { action: "release", clueId: "INV-01", to: "default" });
sa = await state(code, a);
let sb = await state(code, b);
check("低語者拿到自己的角色卡與邀請函", sa.clues.map((c) => c.id).sort(), ["CHAR-低語者", "INV-01"]);
check("犧牲者只拿到公開的邀請函", sb.clues.map((c) => c.id), ["INV-01"]);

const img = sa.clues.find((c) => c.id === "CHAR-低語者").images[0];
check("自己的角色卡圖片讀得到", (await fetch(`${BASE}${img}`)).status, 200);
const stolen = img.replace(encodeURIComponent("低語者"), encodeURIComponent("犧牲者"));
check("別人的角色卡圖片讀不到", (await fetch(`${BASE}${stolen}`)).status, 401);
const bImg = img.replace("who=01", "who=02");
check("拿別人的網址換身分讀不到（簽章不符）", (await fetch(`${BASE}${bImg}`)).status, 401);

const unlocked = await call(`/${code}/unlock-code`, { method: "POST", headers: as(b), body: { clueCode: "v2-bm01" } });
check("玩家輸入代碼自行解鎖（不分大小寫）", unlocked.status, 200);
check("亂打代碼被擋", (await call(`/${code}/unlock-code`, { method: "POST", headers: as(b), body: { clueCode: "NOPE" } })).status, 400);
sb = await state(code, b);
ok("解鎖的線索出現在自己清單", sb.clues.some((c) => c.id === "V2-BM01"));
sa = await state(code, a);
ok("但不會出現在別人清單", !sa.clues.some((c) => c.id === "V2-BM01"));

await act(code, { action: "revoke", clueId: "INV-01" });
sb = await state(code, b);
ok("收回後玩家端消失", !sb.clues.some((c) => c.id === "INV-01"));

await act(code, { action: "unlock", key: "UNLOCK-BOOK2", on: true });
sa = await state(code, a);
ok("開放第二本後出現第二本", sa.docs.some((d) => d.book === "第二本" && d.body));

const r = await call(`/${code}/state?rev=${sa.rev}`, { headers: as(a) });
check("rev 沒變時只回 unchanged", r.json.unchanged, true);

await act(code, { action: "phase", phase: 1 });
sa = await state(code, a);
ok("退回階段會關上被跳過的幕", sa.docs.some((d) => d.title.startsWith("第一幕") && d.body === null));

await act(code, { action: "end" });
check("結束後不能再發放", (await act(code, { action: "release", clueId: "INV-01", to: "all" })).status, 409);
check("結束後新玩家不能入場", (await call(`/${code}/join`, { method: "POST", body: { roleId: "03", nickname: "新人" } })).status, 409);
ok("結束後原玩家仍可回來看", Boolean((await state(code, a))?.clues));

console.log("\n[瘋兔子]（需以 ONLINE_FENGTUZ_MOCK=1 啟動伺服器）");
const f = (await call("", { method: "POST", body: { script: "fengtuz", pin: PIN } })).json.code;
ok("開場取得 RT- 代碼", /^RT-/.test(f ?? ""));
const cat = (await call(`/${f}/catalog`, { headers: host })).json.catalog;
ok("主持人拿到線索全集", cat?.clues.length > 0, JSON.stringify(cat).slice(0, 200));
ok("線索轉成繁體", cat.clues.some((c) => c.title === "遊戲規則"));
const fp = (await call(`/${f}/join`, { method: "POST", body: { roleId: "xia-tong", nickname: "甲" } })).json.identity;
const fq = (await call(`/${f}/join`, { method: "POST", body: { roleId: "jiang-qin", nickname: "乙" } })).json.identity;
const first = cat.clues[0].id;
check("瘋兔子線索沒有預設對象，要指定", (await act(f, { action: "release", clueId: first, to: "default" })).status, 400);
await act(f, { action: "release", clueId: first, to: "xia-tong" });
check("指定角色拿得到", (await call(`/${f}/state`, { headers: as(fp) })).json.player.clues.length, 1);
check("其他角色拿不到", (await call(`/${f}/state`, { headers: as(fq) })).json.player.clues.length, 0);
check(
  "瘋兔子不開放輸入代碼",
  (await call(`/${f}/unlock-code`, { method: "POST", headers: as(fq), body: { clueCode: first } })).status,
  400,
);
await act(f, { action: "freeSeat", roleId: "jiang-qin" });
check("釋出角色後舊憑證失效", (await call(`/${f}/state`, { headers: as(fq) })).status, 401);

done("線上主持測試");
