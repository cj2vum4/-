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
// 場次代碼是「劇本前綴＋日期」、一個劇本一天一場；每個測試場次各用一個隨機日期，重跑也不會撞
const usedDays = new Set();
const randomDay = () => {
  for (;;) {
    const d = new Date(Date.UTC(2100 + Math.floor(Math.random() * 800), 0, 1 + Math.floor(Math.random() * 365)));
    const s = d.toISOString().slice(0, 10);
    if (!usedDays.has(s)) return usedDays.add(s), s;
  }
};
const open = (script, date = randomDay()) => call("", { method: "POST", body: { script, pin: PIN, date } });
const state = async (code, p) => (await call(`/${code}/state`, { headers: as(p) })).json.player;

console.log("\n[天才在左我在右]");
const day = randomDay();
const created = await open("tiancai", day);
const code = created.json.code;
check("場次代碼是劇本前綴＋日期", code, `TC-${day.replace(/-/g, "")}`);
check("同一天同劇本不能再開一場", (await open("tiancai", day)).status, 409);
check("日期格式不對被擋", (await open("tiancai", "2026-02-30")).status, 400);
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
check(
  "同一場的暱稱不能重複",
  (await call(`/${code}/join`, { method: "POST", body: { roleId: "03", nickname: "阿明" } })).json.code,
  "NAME_TAKEN",
);
const find = (date, nickname) => call("/find", { method: "POST", body: { date, nickname } });
let found = (await find(day.replace(/-/g, "/"), " 阿明 ")).json;
ok("日期＋暱稱直接拿回原本的角色與憑證", found.identity?.code === code && found.identity.roleId === "01" && found.identity.token === a.token);
found = (await find(day.replace(/-/g, ""), "新來的")).json;
ok("純數字號碼也找得到；新暱稱列出那天的場次去選角", !found.identity && found.sessions?.length === 1 && found.sessions[0].code === code);
check("那天沒有場次", (await find(randomDay(), "阿明")).status, 404);
await open("fengtuz", day);
found = (await find(day, "新來的")).json;
ok("同一天兩個劇本都有場次就兩個都列出來", found.sessions?.map((x) => x.script).sort().join() === "fengtuz,tiancai");
found = (await call("/find", { method: "POST", body: { date: day, nickname: "新來的", script: "fengtuz" } })).json;
ok("從首頁選了劇本就只找那個劇本", found.sessions?.length === 1 && found.sessions[0].script === "fengtuz");
found = (await call("/find", { method: "POST", body: { date: day, nickname: "阿明", script: "fengtuz" } })).json;
ok("選了別的劇本，不會用暱稱登進另一個劇本的角色", !found.identity && found.sessions?.[0]?.script === "fengtuz");
check("那天沒開這個劇本", (await call("/find", { method: "POST", body: { date: randomDay(), nickname: "x", script: "fengtuz" } })).status, 404);
check("用日期算出代碼、主持密碼回主持台", (await call(`/TC-${day.replace(/-/g, "")}/state`, { headers: host })).status, 200);
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
const f = (await open("fengtuz")).json.code;
ok("開場取得 RT- 代碼", /^RT-/.test(f ?? ""));
const cat = (await call(`/${f}/catalog`, { headers: host })).json.catalog;
ok("主持人拿到線索全集", cat?.clues.length > 0, JSON.stringify(cat).slice(0, 200));
ok("線索依標題與分類載入", cat.clues.some((c) => c.title === "遊戲規則" && c.group === "故事背景"));
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

console.log("\n[瘋兔子人物劇本]");
const g = (await open("fengtuz")).json.code;
const gw = (await call(`/${g}/join`, { method: "POST", body: { roleId: "wang-zhiyu", nickname: "丙" } })).json.identity;
const gx = (await call(`/${g}/join`, { method: "POST", body: { roleId: "xia-tong", nickname: "丁" } })).json.identity;
const docsOf = async (p) => (await call(`/${g}/state`, { headers: as(p) })).json.player.docs;
ok("開場時劇本全部鎖住", (await docsOf(gw)).every((d) => d.body === null));
await act(g, { action: "phase", phase: 1 });
let dw = await docsOf(gw);
ok("切到第一幕後第一幕可讀", dw.some((d) => d.title.startsWith("第一幕 · 瘋兔子") && d.body));
ok("第一幕小劇場仍鎖住", dw.some((d) => d.title === "第一幕 · 小劇場" && d.body === null));
ok("王之喻有專屬的驗牌小劇場", dw.some((d) => d.title === "第一幕 · 驗牌小劇場"));
ok("夏瞳沒有驗牌小劇場", !(await docsOf(gx)).some((d) => d.title === "第一幕 · 驗牌小劇場"));
await act(g, { action: "unlock", key: "FT-SCENE1", on: true });
ok("開放後小劇場可讀", (await docsOf(gw)).some((d) => d.title === "第一幕 · 小劇場" && d.body));
ok("玩家端劇本不含紙本翻頁提示", !(await docsOf(gw)).some((d) => (d.body ?? "").includes("請勿翻開")));

console.log("\n[瘋兔子圖片：角色海報、劇本插圖、手冊板書]");
const fetchStatus = async (url) => (await fetch(`${BASE}${url}`)).status;
const poster = (await call(`/${g}/lobby`)).json.lobby.roles.find((r) => r.id === "xia-tong")?.image;
ok("選角畫面有角色海報", Boolean(poster));
check("拿得到角色海報", await fetchStatus(poster), 200);
check("海報網址不能拿別的圖", await fetchStatus(poster.replace("xia-tong.jpg", "act6-1.jpg")), 401);
const myPoster = (await call(`/${g}/state`, { headers: as(gx) })).json.player.role.image;
ok("入場後角色分頁有自己的海報", Boolean(myPoster) && myPoster.includes("xia-tong.jpg"));
check("玩家拿得到自己的海報", await fetchStatus(myPoster), 200);
check("玩家海報網址不能拿別人的海報", await fetchStatus(myPoster.replace("xia-tong.jpg", "wang-zhiyu.jpg")), 401);
ok("第六幕開放前劇本沒有插圖網址", !(await docsOf(gx)).some((d) => d.images));
const boards = (await call(`/${g}/catalog`, { headers: host })).json.catalog.handbook.find((h) => h.images)?.images;
ok("主持人手冊帶有板書圖網址", boards && Object.keys(boards).length > 0);
check("主持人拿得到板書圖", await fetchStatus(Object.values(boards)[0]), 200);
await act(g, { action: "phase", phase: 6 });
const act6 = (await docsOf(gx)).find((d) => d.title.startsWith("第六幕"));
ok("第六幕開放後帶有插圖網址", Boolean(act6?.images?.["act6-1.jpg"]) && act6.body.includes("[[img:act6-1.jpg]]"));
const pic = act6.images["act6-1.jpg"];
check("玩家拿得到已開放段落的插圖", await fetchStatus(pic), 200);
check("玩家不能拿手冊板書", await fetchStatus(pic.replace("act6-1.jpg", "hb-act3-board.jpg")), 401);
check("玩家不能拿還沒開放的第七幕插圖", await fetchStatus(pic.replace("act6-1.jpg", "act7-1.jpg")), 401);
check("網址換成別的角色就失效", await fetchStatus(pic.replace("who=xia-tong", "who=wang-zhiyu")), 401);

console.log("\n[瘋兔子小劇場開放]");
const k = (await open("fengtuz")).json.code;
const kw = (await call(`/${k}/join`, { method: "POST", body: { roleId: "wang-zhiyu", nickname: "戊" } })).json.identity;
const kx = (await call(`/${k}/join`, { method: "POST", body: { roleId: "xia-tong", nickname: "己" } })).json.identity;
const kState = async (p) => (await call(`/${k}/state`, { headers: as(p) })).json.player;
const kCat = (await call(`/${k}/catalog`, { headers: host })).json.catalog;
ok("小劇場與故事覆盤標在對應的階段", kCat.unlocks.filter((u) => u.phase === "第一幕").length === 2 && kCat.unlocks.filter((u) => u.phase === "第七幕").map((u) => u.key).join() === "FT-S7-1,FT-S7-2,FT-S7-3,FT-S7-4,FT-S7-5,FT-RECAP");
await act(k, { action: "releaseGroup", group: "第一幕" });
let kd = (await kState(kw)).docs;
ok("「全部開放」會開本幕劇本", kd.some((d) => d.title.startsWith("第一幕 · 瘋兔子") && d.body));
ok("「全部開放」不會開小劇場", kd.some((d) => d.title === "第一幕 · 小劇場" && d.body === null));
ok("「全部開放」不會開王之喻的驗牌小劇場", kd.some((d) => d.title === "第一幕 · 驗牌小劇場" && d.body === null));
const before = (await kState(kx)).broadcasts.length;
await act(k, { action: "unlock", key: "FT-SCENE1", on: true });
let kb = (await kState(kx)).broadcasts;
ok("開放小劇場會通知玩家翻頁", kb.length === before + 1 && kb[0].message.includes("【第一幕 · 小劇場】"), kb[0]?.message);
await act(k, { action: "unlock", key: "FT-SCENE1", on: true });
check("重複按開放不會再通知一次", (await kState(kx)).broadcasts.length, before + 1);
await act(k, { action: "unlock", key: "FT-SCENE1-WANG", on: true });
check("王之喻的驗牌小劇場不廣播（免得劇透）", (await kState(kx)).broadcasts.length, before + 1);
ok("王之喻開放後讀得到驗牌小劇場", (await kState(kw)).docs.some((d) => d.title === "第一幕 · 驗牌小劇場" && d.body));
ok("其他角色仍然沒有驗牌小劇場", !(await kState(kx)).docs.some((d) => d.title === "第一幕 · 驗牌小劇場"));

console.log("\n[瘋兔子撲克牌]（假線索 900004 是撲克牌）");
const pk = (await open("fengtuz")).json.code;
const pa = (await call(`/${pk}/join`, { method: "POST", body: { roleId: "wang-zhiyu", nickname: "庚" } })).json.identity;
const pb = (await call(`/${pk}/join`, { method: "POST", body: { roleId: "lin-yunshu", nickname: "辛" } })).json.identity;
const pc = (await call(`/${pk}/join`, { method: "POST", body: { roleId: "xia-tong", nickname: "壬" } })).json.identity;
const pState = async (p) => (await call(`/${pk}/state`, { headers: as(p) })).json.player;
const pOp = (p, op) => call(`/${pk}/poker`, { method: "POST", headers: as(p), body: { op } });
const hOp = (body) => act(pk, { action: "poker", ...body });
const hostPoker = async () => (await call(`/${pk}/state`, { headers: host })).json.host.poker;

ok("撲克牌發出前玩家沒有牌桌", !(await pState(pa)).poker);
check("撲克牌發出前不能洗牌", (await pOp(pa, "shuffle")).status, 401);
await act(pk, { action: "release", clueId: "900004", to: "all" });
let pv = (await pState(pa)).poker;
ok("驗牌時看得到整副 40 張牌面", pv?.mode === "inspect" && pv.deck.length === 40 && pv.deck.every(Boolean));
const order = pv.deck.join();
check("玩家可以洗牌", (await pOp(pa, "shuffle")).status, 200);
pv = (await pState(pb)).poker;
ok("洗牌後牌序改變，紀錄寫著誰洗的", pv.deck.join() !== order && pv.log.some((e) => e.who === "王之喻" && e.action.includes("洗牌")));
await hOp({ op: "deal" });
pv = (await pState(pa)).poker;
ok("開始發牌後看不到新牌堆的牌面", pv.mode === "deal" && pv.deck.length === 40 && pv.deck.every((c) => c === null));
check("開始發牌後玩家不能洗牌", (await pOp(pa, "shuffle")).status, 400);
check("主持人和林雲書開一局", (await hOp({ op: "round", roleId: "lin-yunshu" })).status, 200);
check("沒有收牌前不能開下一局", (await hOp({ op: "round", roleId: "xia-tong" })).status, 400);
let mine = (await pState(pb)).poker.round;
const seen = (await pState(pc)).poker.round;
ok("上桌的玩家看得到自己的起始牌", Boolean(mine.player[0]));
ok("其他人看不到他的起始牌", seen.player[0] === null && seen.roleName === "林雲書");
ok("莊家的起始牌翻牌前誰都看不到", mine.dealer[0] === null && seen.dealer[0] === null);
check("不是自己的回合不能抽牌", (await pOp(pc, "draw")).status, 400);
check("輪到自己可以抽牌", (await pOp(pb, "draw")).status, 200);
ok("抽到的牌大家都看得到", Boolean((await pState(pc)).poker.round.player[1]));
await pOp(pb, "stop");
check("停止後不能再抽", (await pOp(pb, "draw")).status, 400);
await hOp({ op: "dealerDraw" });
await hOp({ op: "reveal" });
mine = (await pState(pc)).poker.round;
ok("翻牌比點後兩邊的牌都公開", mine.revealed && mine.player.every(Boolean) && mine.dealer.every(Boolean));
await hOp({ op: "collect" });
pv = (await pState(pc)).poker;
ok("收牌後棄牌堆 4 張：看得到張數、看不到牌面", pv.round === null && pv.discard.length === 4 && pv.discard.every((c) => c === null));
const hp = await hostPoker();
ok("主持人看得到全部牌面", hp.deck.every(Boolean) && hp.discard.every(Boolean) && hp.deck.length === 36);
check("毒牌標記只能貼在新牌堆裡的牌", (await hOp({ op: "poison", card: hp.discard[0] })).status, 400);
await hOp({ op: "poison", card: hp.deck[5] });
pv = (await pState(pa)).poker;
ok("貼毒牌標記後玩家端公開棄牌堆與新牌堆", pv.mode === "reveal" && pv.deck.every(Boolean) && pv.discard.every(Boolean));
check("毒牌就是主持人點的那張", pv.poison, hp.deck[5]);
check("牌一張都沒少", pv.deck.length + pv.discard.length, 40);
check("公開後不能再洗牌", (await hOp({ op: "shuffle" })).status, 400);

console.log("\n[瘋兔子線索分組]");
ok("開場階段沒有收起來的分組", (await pState(pa)).clueGroups.every((g) => !g.past));
await act(pk, { action: "phase", phase: 1 });
const cg = (await pState(pa)).clueGroups;
ok("進入第一幕後開場的線索收起來", cg.find((g) => g.id === "開場")?.past === true && cg.find((g) => g.id === "第一幕")?.past === false);
ok("每條線索都帶分組", (await pState(pa)).clues.every((c) => typeof c.group === "string"));
ok("天才在左我在右不收線索", sa.clueGroups === undefined);
const hg = (await act(pk, { action: "phase", phase: 1 })).json.host.clueGroups;
ok("主持台線索也依幕分組", hg?.find((g) => g.id === "開場")?.past === true && hg.find((g) => g.id === "第一幕")?.past === false);
await act(pk, { action: "phase", phase: 6 });
const g6 = (await pState(pa)).clueGroups;
ok("第六幕沒有線索，仍停在第五幕、前面幾幕收起來", g6.find((g) => g.id === "第五幕")?.past === false && g6.find((g) => g.id === "第四幕")?.past === true);

console.log("\n[瘋兔子故事覆盤]");
await act(pk, { action: "phase", phase: 7 });
ok("開放前玩家端看不到故事覆盤", !(await pState(pa)).docs.some((d) => d.id === "ft-recap"));
await act(pk, { action: "releaseGroup", group: "第七幕" });
ok("第七幕「全部開放」不會開故事覆盤", !(await pState(pa)).docs.some((d) => d.id === "ft-recap"));
await act(pk, { action: "unlock", key: "FT-RECAP", on: true });
const recap = (await pState(pa)).docs.find((d) => d.id === "ft-recap");
ok("開放後每位玩家都讀得到故事覆盤", Boolean(recap?.body?.includes("【故事覆盤】")) && Boolean((await pState(pb)).docs.find((d) => d.id === "ft-recap")?.body));
ok("故事覆盤不含給 DM 的話", !recap.body.includes("DM") && !recap.body.includes("售後群"));
ok("開放故事覆盤時通知玩家", (await pState(pa)).broadcasts[0]?.message.includes("故事覆盤"));

console.log("\n[瘋兔子飛昇法陣]（假線索 900005 是法陣）");
const cOp = (p, body) => call(`/${pk}/circle`, { method: "POST", headers: as(p), body });
const hostCircle = async () => (await call(`/${pk}/state`, { headers: host })).json.host.circle;
ok("主持台一開始就有空白法陣", (await hostCircle())?.star.length === 6 && (await hostCircle()).names.some((n) => n.id === "liao"));
ok("沒發法陣前玩家端沒有法陣", (await pState(pa)).circle === undefined);
check("沒發法陣前玩家不能改", (await cOp(pa, { op: "pair", slot: "s0", field: "killer", value: "wang-zhiyu" })).status, 401);
await act(pk, { action: "release", clueId: "900005", to: "all" });
check("玩家填頂端角兇手", (await cOp(pa, { op: "pair", slot: "s0", field: "killer", value: "wang-zhiyu" })).status, 200);
await cOp(pb, { op: "pair", slot: "s0", field: "victim", value: "jian-feifei" });
let circ = (await pState(pc)).circle;
ok("別的玩家看到同一張陣法（王→菲）", circ.star[0].killer === "wang-zhiyu" && circ.star[0].victim === "jian-feifei");
check("格子記得最後是誰改的", circ.by.s0, "林雲書");
await cOp(pc, { op: "pair", slot: "center", field: "killer", value: "xia-tong" });
await cOp(pc, { op: "pair", slot: "center", field: "victim", value: "liao" });
await cOp(pa, { op: "dream", row: "xia-tong", value: ["jian-ci", "liao"] });
await cOp(pa, { op: "dream", row: "others", value: ["liao"] });
circ = (await pState(pb)).circle;
ok("中央一格可填夏→廖", circ.center.killer === "xia-tong" && circ.center.victim === "liao");
ok("對照表夢主可填兩個、有「其他分身」", circ.dreams["xia-tong"].join() === "jian-ci,liao" && circ.dreams.others.join() === "liao");
check("夢主最多兩個", (await cOp(pa, { op: "dream", row: "xia-tong", value: ["jian-ci", "liao", "jiang-qin"] })).status, 400);
check("不能填名單外的名字", (await cOp(pa, { op: "pair", slot: "s1", field: "killer", value: "陸江遠" })).status, 400);
check("沒有這一格", (await cOp(pa, { op: "pair", slot: "s6", field: "killer", value: "liao" })).status, 400);
check("玩家不能鎖定陣法", (await cOp(pa, { op: "lock", on: true })).status, 400);
await act(pk, { action: "circle", op: "lock", on: true });
check("鎖定後玩家不能改", (await cOp(pa, { op: "pair", slot: "s1", field: "killer", value: "liao" })).status, 400);
await act(pk, { action: "circle", op: "pair", slot: "s1", field: "killer", value: "jian-feifei" });
check("鎖定後主持人仍可改", (await hostCircle()).star[1].killer, "jian-feifei");
await act(pk, { action: "circle", op: "lock", on: false });
check("解除鎖定後玩家可修正", (await cOp(pa, { op: "pair", slot: "s0", field: "killer", value: "" })).status, 200);
ok("清掉的格子是空的", (await pState(pa)).circle.star[0].killer === "");
ok("修改紀錄有寫誰改了什麼", (await hostCircle()).log.some((e) => e.who === "王之喻" && e.action.includes("頂端角兇手")));
await act(pk, { action: "circle", op: "clear" });
circ = await hostCircle();
ok("清空後整張陣法是空的", circ.star.every((p) => !p.killer && !p.victim) && !Object.keys(circ.dreams).length && !circ.locked);

done("線上主持測試");
