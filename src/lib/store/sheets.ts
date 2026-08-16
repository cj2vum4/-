import { google, type sheets_v4 } from "googleapis";
import type { LogEntry, Player, SessionMeta } from "../types";
import {
  LOG_HEADERS,
  PLAYER_HEADERS,
  SESSION_HEADERS,
  logTabName,
  logToRow,
  playerToRow,
  playersTabName,
  rowToLog,
  rowToPlayer,
  rowToSession,
  sessionToRow,
  sessionsTabName,
  type StoreDriver,
} from "./driver";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Google Sheets 有「每分鐘 60 次寫入 / 每使用者」的配額，
 * 主持人連續快速操作時會撞到 429。這裡用指數退避重試，
 * 讓短暫的尖峰自己消化掉，而不是把錯誤丟給主持人。
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
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
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    // 允許直接貼 JSON，或為了避開多行環境變數而使用 base64
    const text = raw.trim().startsWith("{")
      ? raw
      : Buffer.from(raw, "base64").toString("utf8");
    const creds = JSON.parse(text);
    return new google.auth.GoogleAuth({ credentials: creds, scopes: SCOPES });
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (email && key) {
    return new google.auth.GoogleAuth({
      credentials: { client_email: email, private_key: key.replace(/\\n/g, "\n") },
      scopes: SCOPES,
    });
  }

  // 交給 GOOGLE_APPLICATION_CREDENTIALS / ADC
  return new google.auth.GoogleAuth({ scopes: SCOPES });
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

  private api: sheets_v4.Sheets;
  private spreadsheetId: string;
  private initPromise: Promise<void> | null = null;
  /** 已知存在的分頁名稱，避免每次都打 spreadsheets.get */
  private knownTabs = new Set<string>();
  /** id -> 試算表列號（1-based），savePlayer/saveSession 用來定位 */
  private rowIndex = new Map<string, Map<string, number>>();

  constructor() {
    this.api = google.sheets({ version: "v4", auth: buildAuth() });
    this.spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
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

  /** 分頁不存在就建立，並寫入表頭 */
  private async ensureTab(title: string, headers: string[]): Promise<void> {
    if (this.knownTabs.has(title)) return;
    await this.refreshTabs();
    if (this.knownTabs.has(title)) return;

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
    const rows = await this.readRows(tab, "G");
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
    await this.updateRow(tab, row, "G", sessionToRow(meta));
  }

  // ---- 玩家 ----

  async listPlayers(code: string): Promise<Player[]> {
    await this.init();
    const tab = playersTabName(code);
    const rows = await this.readRows(tab, "I");
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
        range: range(tab, `A${row}:I${row}`),
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

  // ---- 紀錄 ----

  async listLog(code: string, limit: number): Promise<LogEntry[]> {
    await this.init();
    const rows = await this.readRows(logTabName(code), "I");
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
}
