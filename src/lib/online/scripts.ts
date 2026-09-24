import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadFengtuzClues } from "./fengtuz-cards";
import type {
  BroadcastTemplate,
  ClueGroup,
  HandbookSection,
  HostClue,
  OnlinePhase,
  OnlineRole,
  OnlineScriptId,
  UnlockDef,
} from "./types";

/**
 * 線上主持的劇本定義（只在伺服器端使用）。
 *
 * 劇本內容放在 content/online/<劇本>/，執行時用 fs 讀，
 * 不走 import——這樣就算哪天有人不小心在 client component import 了這支，
 * 打包工具也拿不到內容，只會建置失敗。
 */

export const CONTENT_ROOT = join(process.cwd(), "content", "online");

/** 每個角色的劇本段落。unlockAny 任一個鍵打開就能讀 */
export interface DocDef {
  id: string;
  book: string;
  title: string;
  unlockAny: string[];
  body: string;
  /** 這個鍵打開之前，連標題都不給（第二本劇本的存在本身就是劇透） */
  secretUntil?: string;
}

export interface ScriptDef {
  id: OnlineScriptId;
  title: string;
  /** 場次代碼前綴，一眼就看得出是哪個劇本 */
  codePrefix: string;
  roles: OnlineRole[];
  phases: OnlinePhase[];
  groups: ClueGroup[];
  unlocks: UnlockDef[];
  templates: BroadcastTemplate[];
  handbook: HandbookSection[];
  /** 切換階段時是否自動廣播一則系統通知 */
  announcePhase: boolean;
  /** 玩家能否輸入線索代碼自行解鎖（主持人口頭給代碼的玩法） */
  selfUnlock: boolean;
  loadClues(): Promise<{ clues: HostClue[]; note?: string }>;
  docsFor(roleId: string): { hint: string; list: DocDef[] };
}

interface TiancaiContent {
  roles: OnlineRole[];
  phases: OnlinePhase[];
  groups: ClueGroup[];
  unlocks: UnlockDef[];
  clues: HostClue[];
  docs: Record<string, { hint: string; list: DocDef[] }>;
  handbook: HandbookSection[];
  templates: BroadcastTemplate[];
}

interface FengtuzContent {
  roles: OnlineRole[];
  phases: OnlinePhase[];
  templates: BroadcastTemplate[];
  handbook: HandbookSection[];
}

function readContent<T>(script: OnlineScriptId): T {
  return JSON.parse(readFileSync(join(CONTENT_ROOT, script, "content.json"), "utf8")) as T;
}

let tiancaiCache: TiancaiContent | null = null;
const tiancai = () => (tiancaiCache ??= readContent<TiancaiContent>("tiancai"));

let fengtuzCache: FengtuzContent | null = null;
const fengtuz = () => (fengtuzCache ??= readContent<FengtuzContent>("fengtuz"));

function buildTiancai(): ScriptDef {
  const c = tiancai();
  return {
    id: "tiancai",
    title: "天才在左我在右",
    codePrefix: "TC-",
    roles: c.roles,
    phases: c.phases,
    groups: c.groups,
    unlocks: c.unlocks,
    templates: c.templates,
    handbook: c.handbook,
    announcePhase: true,
    selfUnlock: true,
    async loadClues() {
      return { clues: c.clues };
    },
    docsFor(roleId) {
      return c.docs[roleId] ?? { hint: "", list: [] };
    },
  };
}

function buildFengtuz(): ScriptDef {
  const c = fengtuz();
  return {
    id: "fengtuz",
    title: "瘋兔子，白又白，砍下腦袋飛起來",
    codePrefix: "RT-",
    roles: c.roles,
    phases: c.phases,
    // 瘋兔子的線索依 OCR 時的資料夾分組，分組在載入線索後才知道
    groups: [],
    unlocks: [],
    templates: c.templates,
    handbook: c.handbook,
    announcePhase: false,
    selfUnlock: false,
    loadClues: loadFengtuzClues,
    docsFor() {
      return { hint: "", list: [] };
    },
  };
}

const builders: Record<OnlineScriptId, () => ScriptDef> = {
  fengtuz: buildFengtuz,
  tiancai: buildTiancai,
};

export const ONLINE_SCRIPT_IDS = Object.keys(builders) as OnlineScriptId[];

export function isScriptId(v: string): v is OnlineScriptId {
  return (ONLINE_SCRIPT_IDS as string[]).includes(v);
}

const defs = new Map<OnlineScriptId, ScriptDef>();

export function getScript(id: OnlineScriptId): ScriptDef {
  let def = defs.get(id);
  if (!def) {
    def = builders[id]();
    defs.set(id, def);
  }
  return def;
}

/** 依場次代碼前綴反查劇本 */
export function scriptForCode(code: string): OnlineScriptId | null {
  for (const id of ONLINE_SCRIPT_IDS) {
    if (code.startsWith(getScript(id).codePrefix)) return id;
  }
  return null;
}

/** 線索依分組整理；分組沒有預先定義時（瘋兔子）就用線索自帶的 group 產生 */
export function groupsOf(def: ScriptDef, clues: HostClue[]): ClueGroup[] {
  if (def.groups.length) return def.groups;
  const seen = new Set<string>();
  const groups: ClueGroup[] = [];
  for (const c of clues) {
    if (seen.has(c.group)) continue;
    seen.add(c.group);
    groups.push({ id: c.group, label: c.group || "未分類" });
  }
  return groups;
}
