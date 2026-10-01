/**
 * 瘋兔子第三～五幕的飛昇法陣：所有玩家與主持人共同編輯同一張陣法。
 *
 * 照 DM 手冊的板書：
 *   六芒星六個角各寫一組「兇手→死者」，中央一格（第四幕加上的「夏→廖」）
 *   左邊「分身→夢主」對照表：每個角色一列，另有「其他分身」一列；夢主最多填兩個（「簡辭／廖向冬」）
 *
 * 前後端共用，只放規則，不放任何劇本內容。名字一律用選的，存的是名字 id（角色 id 或 liao）。
 */
import type { CircleOp, CirclePair, CircleState } from "./types";

/** 六個角，順時針從頂端開始 */
export const CORNERS = ["頂端", "右上", "右下", "底端", "左下", "左上"] as const;
export const OTHERS = "others";
export const OTHERS_LABEL = "其他分身";
export const MAX_DREAMERS = 2;
const MAX_LOG = 60;

/** DM 扮演的廖向冬也會被寫進陣法 */
export const LIAO = { id: "liao", name: "廖向冬" };

export interface CircleName {
  id: string;
  name: string;
  /** 陣法上寫的單字，和板書一樣：王→菲 */
  short: string;
}

// 板書用的單字；沒列的取名字第一個字（王、林、夏、姜、廖）
const SHORT: Record<string, string> = { 簡菲菲: "菲", 簡辭: "簡" };

export function circleNames(roles: { id: string; name: string }[]): CircleName[] {
  return [...roles, LIAO].map((r) => ({ id: r.id, name: r.name, short: SHORT[r.name] ?? r.name.slice(0, 1) }));
}

const emptyPair = (): CirclePair => ({ killer: "", victim: "" });

export function emptyCircle(): CircleState {
  return { star: CORNERS.map(emptyPair), center: emptyPair(), dreams: {}, locked: false, by: {}, log: [] };
}

/** 格子的代號：s0–s5 六個角、center 中央、d:<角色 id> 對照表 */
export function pairSlot(slot: string): number | "center" | null {
  if (slot === "center") return "center";
  const m = /^s([0-5])$/.exec(slot);
  return m ? Number(m[1]) : null;
}

export function slotLabel(slot: string, names: CircleName[]): string {
  const at = pairSlot(slot);
  if (at === "center") return "中央";
  if (typeof at === "number") return `${CORNERS[at]}角`;
  const row = slot.slice(2);
  return `對照表「${row === OTHERS ? OTHERS_LABEL : nameOf(names, row)}」`;
}

export function nameOf(names: CircleName[], id: string): string {
  return names.find((n) => n.id === id)?.name ?? id;
}

/** 對照表有哪幾列：每個角色一列，加上「其他分身」 */
export function dreamRows(roles: { id: string }[]): string[] {
  return [...roles.map((r) => r.id), OTHERS];
}

export class CircleError extends Error {}

/**
 * 套用一次編輯，回傳要記進紀錄的文字。host 才能鎖定、清空；鎖定後玩家不能改。
 * 不合法的操作丟 CircleError。
 */
export function applyCircleOp(
  c: CircleState,
  op: CircleOp,
  ctx: { names: CircleName[]; rows: string[]; who: string; host: boolean },
): string {
  const { names, rows, who, host } = ctx;
  const valid = (id: string) => id === "" || names.some((n) => n.id === id);

  if (op.op === "lock" || op.op === "clear") {
    if (!host) throw new CircleError("只有主持人可以這樣做");
    if (op.op === "lock") {
      c.locked = Boolean(op.on);
      return c.locked ? "鎖定陣法（血肉苦楚，白日飛昇）" : "解除鎖定，可以修正陣法";
    }
    Object.assign(c, { ...emptyCircle(), log: c.log });
    return "清空陣法";
  }

  if (c.locked && !host) throw new CircleError("陣法已經鎖定，請等主持人解除");

  if (op.op === "pair") {
    const at = pairSlot(op.slot);
    if (at === null) throw new CircleError("沒有這一格");
    if (op.field !== "killer" && op.field !== "victim") throw new CircleError("沒有這一格");
    const value = String(op.value ?? "");
    if (!valid(value)) throw new CircleError("沒有這個名字");
    const pair = at === "center" ? c.center : c.star[at];
    pair[op.field] = value;
    c.by[op.slot] = who;
    const label = op.field === "killer" ? "兇手" : "死者";
    return `${slotLabel(op.slot, names)}${label}：${value ? nameOf(names, value) : "清除"}`;
  }

  if (op.op === "dream") {
    if (!rows.includes(op.row)) throw new CircleError("對照表沒有這一列");
    const list = [...new Set((Array.isArray(op.value) ? op.value : []).map(String))];
    if (list.length > MAX_DREAMERS) throw new CircleError(`夢主最多填 ${MAX_DREAMERS} 個`);
    if (!list.every((id) => id && valid(id))) throw new CircleError("沒有這個名字");
    const slot = `d:${op.row}`;
    if (list.length) c.dreams[op.row] = list;
    else delete c.dreams[op.row];
    c.by[slot] = who;
    return `${slotLabel(slot, names)}的夢主：${list.length ? list.map((id) => nameOf(names, id)).join("／") : "清除"}`;
  }

  throw new CircleError("未知的陣法操作");
}

export function circleLog(c: CircleState, who: string, action: string, at: string) {
  c.log = [...c.log, { who, action, at }].slice(-MAX_LOG);
}
