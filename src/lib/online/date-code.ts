/**
 * 場次代碼＝劇本前綴＋日期（台北時間），例如 RT-20261001。一個劇本一天一場。
 * 畫面上只顯示、也只要輸入 8 位數字的日期（20261001）；前綴只在網址與內部用來分劇本。
 * 玩家用「號碼＋暱稱」、主持人用「號碼＋密碼」回到場次，不用記隨機代碼。
 *
 * 前後端共用。早期的隨機代碼（RT-4HX8PA）仍然能用連結進入。
 */

/** 今天（台北時間）的 YYYYMMDD */
export function todayKey(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parts.replace(/-/g, "");
}

/** 接受 2026-10-01、2026/10/1、20261001，回傳 YYYYMMDD；不是真實日期回傳 null */
export function parseDateKey(raw: string): string | null {
  const t = (raw ?? "").trim();
  const m = /^(\d{4})[-/.]?(\d{1,2})[-/.]?(\d{1,2})$/.exec(t);
  if (!m || (!/[-/.]/.test(t) && t.length !== 8)) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${y}${String(mo).padStart(2, "0")}${String(d).padStart(2, "0")}`;
}

export function codeForDate(prefix: string, key: string): string {
  return prefix + key;
}

/** RT-20261001 → 20261001（畫面上顯示的場次號碼）；不是日期代碼回傳 null */
export function dateOfCode(code: string): string | null {
  const m = /^[A-Z]{2}-(\d{8})$/.exec(code);
  return m ? m[1] : null;
}
