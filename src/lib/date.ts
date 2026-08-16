/**
 * 把玩家／主持人輸入的各種日期寫法正規化成 YYYY-MM-DD。
 * 接受：2026-08-16、2026/8/16、20260816、8/16（補今年）
 * 無法解析時回傳 null。
 */
export function normalizeSessionCode(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;

  // 以任何非數字字元當分隔符，一次吃下 2026-08-16 / 2026/8/16 / 2026.8.16 / 2026年8月16日
  const tokens = s.split(/[^0-9]+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const thisYear = new Date().getFullYear();
  let y: number;
  let m: number;
  let d: number;

  if (tokens.length >= 3) {
    y = Number(tokens[0]);
    m = Number(tokens[1]);
    d = Number(tokens[2]);
    if (y < 100) y += 2000;
  } else if (tokens.length === 2) {
    // 只給月日，補上今年
    y = thisYear;
    m = Number(tokens[0]);
    d = Number(tokens[1]);
  } else {
    // 一串連續數字，依長度切
    const t = tokens[0];
    if (t.length === 8) {
      y = Number(t.slice(0, 4));
      m = Number(t.slice(4, 6));
      d = Number(t.slice(6, 8));
    } else if (t.length === 6) {
      y = 2000 + Number(t.slice(0, 2));
      m = Number(t.slice(2, 4));
      d = Number(t.slice(4, 6));
    } else if (t.length === 4) {
      y = thisYear;
      m = Number(t.slice(0, 2));
      d = Number(t.slice(2, 4));
    } else if (t.length === 3) {
      y = thisYear;
      m = Number(t.slice(0, 1));
      d = Number(t.slice(1, 3));
    } else {
      return null;
    }
  }

  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  // 用 Date 反查，擋掉 2 月 30 日這種不存在的日期
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function todayCode(): string {
  const now = new Date();
  // 以台北時間為準，避免伺服器在 UTC 時「今天」對不上
  const tpe = new Date(now.getTime() + 8 * 3600 * 1000);
  return tpe.toISOString().slice(0, 10);
}

export function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  }).format(d);
}
