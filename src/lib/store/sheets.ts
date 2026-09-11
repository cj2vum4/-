import { google, type sheets_v4 } from "googleapis";
import { readCredentials } from "./credentials";
import type { LogEntry, Player, Report, SessionMeta, Vote } from "../types";
import {
  LOG_HEADERS,
  LOG_LAST_COL,
  PLAYER_HEADERS,
  PLAYER_LAST_COL,
  REPORT_HEADERS,
  REPORT_LAST_COL,
  VOTE_HEADERS,
  VOTE_LAST_COL,
  SESSION_HEADERS,
  SESSION_LAST_COL,
  logTabName,
  logToRow,
  playerToRow,
  playersTabName,
  reportToRow,
  voteToRow,
  votesTabName,
  archiveTabName,
  reportsTabName,
  rowToLog,
  rowToPlayer,
  rowToReport,
  rowToVote,
  rowToSession,
  sessionToRow,
  sessionsTabName,
  type ArchiveSheet,
  type StoreDriver,
} from "./driver";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

/** 表頭與目前定義不符、且已有資料的分頁。由 /api/health 回報給操作者。 */
const schemaWarnings = new Set<string>();

export function schemaMismatchTabs(): string[] {
  return [...schemaWarnings];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Google Sheets 有「每分鐘 60 次寫入 / 每使用者」的配額，
 * 主持人連續快速操作時會撞到 429。這裡用指數退避重試，
 * 讓短暫的尖峰自己消化掉，而不是把錯誤丟給主持人。
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 7): Promise<T> {
  // 配額是「每分鐘」重置，所以退避總時長要能跨過一分鐘的邊界：
  // 0.6 + 1.2 + 2.4 + 4.8 + 9.6 + 19.2 ≈ 38 秒，足以等到配額回復
  let delay = 600;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const e = err as { code?: number; status?: number; response?: { status?: number } };
      const status = e?.code ?? e?.status ?? e?.response?.status;
      const retryable = status === 429 || (typeof status === "number" && status >= 500 && status < 600);
      if (!retryable || i >= attempts - 1) throw err;
      // 加一點亂數，避免多個請求同時醒來又一起撞牆
      await sleep(delay + Math.random() * 300);
      delay *= 2;
    }
  }
}

/** 1 -> A, 2 -> B … 目前欄數都在 Z 以內 */
function colLetter(count: number): string {
  return String.fromCharCode("A".charCodeAt(0) + count - 1);
}

/** 分頁名稱在 A1 range 中要用單引號包起來，名稱內的單引號要加倍 */
function range(tab: string, a1: string): string {
  return `'${tab.replace(/'/g, "''")}'!${a1}`;
}

export function sheetsConfigured(): boolean {
  if (!process.env.GOOGLE_SHEETS_SPREADSHEET_ID) return false;
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY),
  );
}

function buildAuth() {
  const credentials = readCredentials();
  // readCredentials 回 null 代表要走 GOOGLE_APPLICATION_CREDENTIALS / ADC
  return credentials
    ? new google.auth.GoogleAuth({ credentials, scopes: SCOPES })
    : new google.auth.GoogleAuth({ scopes: SCOPES });
}

/**
 * Google Sheets driver。
 *
 * 資料結構：
 *   場次總表            ← 所有場次的索引
 *   {YYYY-MM-DD}_玩家   ← 該場次玩家與目前餘額
 *   {YYYY-MM-DD}_紀錄   ← 該場次 append-only 流水帳
 */
export class SheetsDriver implements StoreDriver {
  readonly kind = "sheets" as const;

  private apiInstance: sheets_v4.Sheets | null = null;
  private spreadsheetId: string;
  private initPromise: Promise<void> | null = null;
  /** 已知存在的分頁名稱，避免每次都打 spreadsheets.get */
  private knownTabs = new Set<string>();
  /** 這次程序啟動後已檢查過表頭的分頁，避免重複檢查 */
  private headerChecked = new Set<string>();
  /** id -> 試算表列號（1-based），savePlayer/saveSession 用來定位 */
  private rowIndex = new Map<string, Map<string, number>>();

  constructor() {
    // 建構子刻意不解析憑證。若在這裡拋出例外，會連帶讓每一個頁面與
    // /api/health 都變成 500——而 /api/health 正是要用來診斷憑證問題的端點。
    this.spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? "";
  }

  /** 第一次真正要打 API 時才建立認證，錯誤會以一般的 API 錯誤浮現 */
  private get api(): sheets_v4.Sheets {
    this.apiInstance ??= google.sheets({ version: "v4", auth: buildAuth() });
    return this.apiInstance;
  }

  init(): Promise<void> {
    this.initPromise ??= this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    await this.refreshTabs();
    await this.ensureTab(sessionsTabName(), SESSION_HEADERS);
  }

  private async refreshTabs(): Promise<void> {
    const res = await withRetry(() =>
      this.api.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: "sheets.properties.title",
      }),
    );
    this.knownTabs = new Set(
      (res.data.sheets ?? [])
        .map((s) => s.properties?.title)
        .filter((t): t is string => Boolean(t)),
    );
  }

  /**
   * 分頁不存在就建立並寫入表頭；已存在則檢查表頭是否為最新版。
   * 欄位定義改版時，舊分頁的表頭若不修好，寫入的資料會整排錯位。
   */
  private async ensureTab(title: string, headers: string[]): Promise<void> {
    if (this.knownTabs.has(title)) {
      await this.ensureHeaders(title, headers);
      return;
    }
    await this.refreshTabs();
    if (this.knownTabs.has(title)) {
      await this.ensureHeaders(title, headers);
      return;
    }

    try {
      await withRetry(() =>
        this.api.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: { requests: [{ addSheet: { properties: { title } } }] },
        }),
      );
    } catch (err) {
      // 併發情況下可能已被其他請求建好，重新確認一次
      await this.refreshTabs();
      if (!this.knownTabs.has(title)) throw err;
      return;
    }

    this.knownTabs.add(title);
    await withRetry(() =>
      this.api.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: range(title, "A1"),
        valueInputOption: "RAW",
        requestBody: { values: [headers] },
      }),
    );
  }

  /**
   * 檢查表頭是否為最新定義。
   *
   * 只有「空分頁」才會自動修表頭。已經有資料的分頁一律不動——
   * 欄位定義改版後若只改表頭不搬資料，既有的每一列都會整排錯位，
   * 那比留著舊表頭更糟，而且是靜默發生的。
   * 這種情況改為記錄下來，由 /api/health 回報，請人工決定要遷移還是刪除。
   */
  private async ensureHeaders(title: string, headers: string[]): Promise<void> {
    if (this.headerChecked.has(title)) return;
    this.headerChecked.add(title);

    const lastCol = colLetter(headers.length);
    const res = await withRetry(() =>
      this.api.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: range(title, `A1:${lastCol}2`),
      }),
    );
    const rows = res.data.values ?? [];
    const current = (rows[0] ?? []).map((v) => String(v ?? ""));
    const same =
      current.length === headers.length && headers.every((h, i) => current[i] === h);
    if (same) return;

    const hasData = rows.length > 1 && (rows[1] ?? []).some((v) => String(v ?? "").trim());
    if (hasData) {
      schemaWarnings.add(title);
      console.error(
        `[九爺] 分頁「${title}」的表頭是舊版且已有資料，未自動更動以免欄位錯位。` +
          `請將該分頁遷移或刪除（npm run session:remove -- <場次代碼>）。`,
      );
      return;
    }

    console.warn(`[九爺] 分頁「${title}」為空且表頭非最新版，已自動更新表頭`);
    await withRetry(() =>
      this.api.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: range(title, "A1"),
        valueInputOption: "RAW",
        requestBody: { values: [headers] },
      }),
    );
  }

  private async readRows(tab: string, lastCol: string): Promise<unknown[][]> {
    if (!this.knownTabs.has(tab)) {
      await this.refreshTabs();
      if (!this.knownTabs.has(tab)) return [];
    }
    const res = await withRetry(() =>
      this.api.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: range(tab, `A2:${lastCol}`),
        valueRenderOption: "UNFORMATTED_VALUE",
      }),
    );
    return (res.data.values ?? []) as unknown[][];
  }

  private async appendRow(tab: string, row: (string | number)[]): Promise<void> {
    await withRetry(() =>
      this.api.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: range(tab, "A1"),
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] },
      }),
    );
  }

  private async updateRow(
    tab: string,
    rowNumber: number,
    lastCol: string,
    row: (string | number)[],
  ): Promise<void> {
    await withRetry(() =>
      this.api.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: range(tab, `A${rowNumber}:${lastCol}${rowNumber}`),
        valueInputOption: "RAW",
        requestBody: { values: [row] },
      }),
    );
  }

  private setRowIndex(tab: string, ids: string[]): void {
    const map = new Map<string, number>();
    // 資料從第 2 列開始（第 1 列是表頭）
    ids.forEach((id, i) => map.set(id, i + 2));
    this.rowIndex.set(tab, map);
  }

  // ---- 場次 ----

  async listSessions(): Promise<SessionMeta[]> {
    await this.init();
    const tab = sessionsTabName();
    const rows = await this.readRows(tab, SESSION_LAST_COL);
    const list = rows.map(rowToSession).filter((s): s is SessionMeta => s !== null);
    this.setRowIndex(tab, rows.map((r) => String(r[0] ?? "")));
    return list;
  }

  async getSession(code: string): Promise<SessionMeta | null> {
    const all = await this.listSessions();
    return all.find((s) => s.code === code) ?? null;
  }

  async createSession(meta: SessionMeta): Promise<void> {
    await this.init();
    await Promise.all([
      this.ensureTab(playersTabName(meta.code), PLAYER_HEADERS),
      this.ensureTab(logTabName(meta.code), LOG_HEADERS),
      this.ensureTab(reportsTabName(meta.code), REPORT_HEADERS),
    ]);
    await this.appendRow(sessionsTabName(), sessionToRow(meta));
    this.rowIndex.delete(sessionsTabName());
  }

  async saveSession(meta: SessionMeta): Promise<void> {
    await this.init();
    const tab = sessionsTabName();
    let row = this.rowIndex.get(tab)?.get(meta.code);
    if (!row) {
      await this.listSessions();
      row = this.rowIndex.get(tab)?.get(meta.code);
    }
    if (!row) throw new Error(`場次 ${meta.code} 不存在於總表`);
    await this.updateRow(tab, row, SESSION_LAST_COL, sessionToRow(meta));
  }

  // ---- 玩家 ----

  async listPlayers(code: string): Promise<Player[]> {
    await this.init();
    const tab = playersTabName(code);
    const rows = await this.readRows(tab, PLAYER_LAST_COL);
    this.setRowIndex(tab, rows.map((r) => String(r[0] ?? "")));
    return rows.map(rowToPlayer).filter((p): p is Player => p !== null);
  }

  async createPlayer(code: string, player: Player): Promise<void> {
    await this.init();
    const tab = playersTabName(code);
    await this.ensureTab(tab, PLAYER_HEADERS);
    await this.appendRow(tab, playerToRow(player));
    this.rowIndex.delete(tab);
  }

  /**
   * 一次 batchUpdate 寫回所有異動的玩家。
   * 逐筆呼叫的話每人約 0.7 秒，全體發放給 20 人要等十幾秒；
   * 併成一次請求後不論幾人都是一次往返。
   */
  async savePlayers(code: string, players: Player[]): Promise<void> {
    if (players.length === 0) return;
    await this.init();
    const tab = playersTabName(code);

    let index = this.rowIndex.get(tab);
    if (!index || players.some((p) => !index!.has(p.id))) {
      await this.listPlayers(code);
      index = this.rowIndex.get(tab);
    }

    const data = players.map((player) => {
      const row = index?.get(player.id);
      if (!row) throw new Error(`玩家 ${player.id} 不存在於 ${tab}`);
      return {
        range: range(tab, `A${row}:${PLAYER_LAST_COL}${row}`),
        values: [playerToRow(player)],
      };
    });

    await withRetry(() =>
      this.api.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { valueInputOption: "RAW", data },
      }),
    );
  }

  // ---- 舉報 ----

  async listVotes(code: string): Promise<Vote[]> {
    await this.init();
    const rows = await this.readRows(votesTabName(code), VOTE_LAST_COL);
    return rows.map(rowToVote).filter((v): v is Vote => v !== null);
  }

  async createVote(code: string, vote: Vote): Promise<void> {
    await this.init();
    const tab = votesTabName(code);
    await this.ensureTab(tab, VOTE_HEADERS);
    await this.appendRow(tab, voteToRow(vote));
  }

  async listReports(code: string): Promise<Report[]> {
    await this.init();
    const tab = reportsTabName(code);
    const rows = await this.readRows(tab, REPORT_LAST_COL);
    this.setRowIndex(tab, rows.map((r) => String(r[0] ?? "")));
    return rows.map(rowToReport).filter((r): r is Report => r !== null);
  }

  async createReport(code: string, report: Report): Promise<void> {
    await this.init();
    const tab = reportsTabName(code);
    await this.ensureTab(tab, REPORT_HEADERS);
    await this.appendRow(tab, reportToRow(report));
    this.rowIndex.delete(tab);
  }

  async saveReports(code: string, reports: Report[]): Promise<void> {
    if (reports.length === 0) return;
    await this.init();
    const tab = reportsTabName(code);

    let index = this.rowIndex.get(tab);
    if (!index || reports.some((r) => !index!.has(r.id))) {
      await this.listReports(code);
      index = this.rowIndex.get(tab);
    }

    const data = reports.map((r) => {
      const row = index?.get(r.id);
      if (!row) throw new Error(`舉報 ${r.id} 不存在於 ${tab}`);
      return {
        range: range(tab, `A${row}:${REPORT_LAST_COL}${row}`),
        values: [reportToRow(r)],
      };
    });

    await withRetry(() =>
      this.api.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { valueInputOption: "RAW", data },
      }),
    );
  }

  // ---- 紀錄 ----

  async listLog(code: string, limit: number): Promise<LogEntry[]> {
    await this.init();
    const rows = await this.readRows(logTabName(code), LOG_LAST_COL);
    return rows
      .slice(-limit)
      .map(rowToLog)
      .filter((e): e is LogEntry => e !== null);
  }

  async appendLogs(code: string, entries: LogEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.init();
    const tab = logTabName(code);
    await this.ensureTab(tab, LOG_HEADERS);
    await withRetry(() =>
      this.api.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: range(tab, "A1"),
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: entries.map(logToRow) },
      }),
    );
  }

  /**
   * 封存：把彙整內容寫進一個以場次代碼命名的分頁，再刪掉三個工作分頁。
   *
   * 順序很重要——先寫彙整、確認成功了才刪，中途失敗最多是多一個分頁，
   * 不會把資料弄丟。
   */
  async archiveSession(code: string, sheet: ArchiveSheet): Promise<void> {
    await this.init();

    const archive = archiveTabName(code);
    await this.ensureTab(archive, []);
    await withRetry(() =>
      this.api.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: range(archive, "A1"),
        valueInputOption: "RAW",
        requestBody: { values: sheet.rows },
      }),
    );

    await this.deleteTabs([
      playersTabName(code),
      logTabName(code),
      reportsTabName(code),
      votesTabName(code),
    ]);
  }

  async readArchive(code: string): Promise<(string | number)[][] | null> {
    await this.init();
    const tab = archiveTabName(code);
    if (!this.knownTabs.has(tab)) {
      await this.refreshTabs();
      if (!this.knownTabs.has(tab)) return null;
    }
    const res = await withRetry(() =>
      this.api.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: range(tab, "A1:N2000"),
        valueRenderOption: "UNFORMATTED_VALUE",
      }),
    );
    return (res.data.values ?? []) as (string | number)[][];
  }

  /** 刪掉指定分頁。不存在的直接略過，重複封存也不會出錯。 */
  private async deleteTabs(titles: string[]): Promise<void> {
    const res = await withRetry(() =>
      this.api.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: "sheets.properties(sheetId,title)",
      }),
    );
    const byTitle = new Map(
      (res.data.sheets ?? [])
        .map((sh) => [sh.properties?.title ?? "", sh.properties?.sheetId])
        .filter((e): e is [string, number] => Boolean(e[0]) && typeof e[1] === "number"),
    );

    const requests = titles
      .map((t) => byTitle.get(t))
      .filter((id): id is number => typeof id === "number")
      .map((sheetId) => ({ deleteSheet: { sheetId } }));
    if (requests.length === 0) return;

    await withRetry(() =>
      this.api.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests },
      }),
    );
    titles.forEach((t) => this.knownTabs.delete(t));
  }
}
