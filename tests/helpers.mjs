/**
 * 測試共用的小工具。
 *
 * 場次代碼現在由伺服器產生（當天日期，同一天第二場加序號），
 * 測試不再自己編日期——開場時給一組密碼，拿回代碼。
 */
export const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";

export async function call(path, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(`${BASE}/api/sessions${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

/** 每次跑都用沒被用過的密碼，測試才能重複執行 */
export function randomPassword(prefix = "t") {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 開一場，回傳 { code, password }。密碼同時是主持人的通行憑證。 */
export async function openSession(title = "") {
  const password = randomPassword();
  const r = await call("", { method: "POST", body: { password, title } });
  if (r.status !== 200) throw new Error(`開場失敗：${JSON.stringify(r.json)}`);
  return { code: r.json.session.code, password };
}

export const hostHeaders = (password) => ({ "x-host-pin": password });
export const asPlayer = (p) => ({ "x-player-id": p.id, "x-join-code": p.joinCode });

/**
 * 讓全場把票投完，好讓測試能離開第一週。
 *
 * 第一週結束前必須所有人投完票（見 setStage 的閘門），所以任何會走過
 * 第一週的測試都要先呼叫這個。三張票要投給三個不同的人，人不夠時票數會自動下修。
 */
export async function castAllVotes(code, players) {
  for (const voter of players) {
    const targets = players.filter((p) => p.id !== voter.id);
    let approve = 2;
    let oppose = 1;
    for (const target of targets) {
      const kind = approve > 0 ? "approve" : oppose > 0 ? "oppose" : null;
      if (!kind) break;
      const r = await call(`/${code}/votes`, {
        method: "POST",
        headers: asPlayer(voter),
        body: { targetId: target.id, kind },
      });
      if (r.status !== 200) continue;
      if (kind === "approve") approve--;
      else oppose--;
    }
  }
}

export function makeChecker() {
  const state = { failed: 0 };
  const check = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) state.failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) {
      console.log(`        實際 ${JSON.stringify(actual)}`);
      console.log(`        預期 ${JSON.stringify(expected)}`);
    }
  };
  const ok = (label, cond, detail = "") => {
    if (!cond) state.failed++;
    console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `\n        ${detail}`}`);
  };
  const done = (name) => {
    console.log(state.failed === 0 ? `\n${name}全部通過` : `\n${state.failed} 個案例失敗`);
    process.exit(state.failed === 0 ? 0 : 1);
  };
  return { check, ok, done };
}
