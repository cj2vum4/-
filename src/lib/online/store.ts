import { google, type sheets_v4 } from "googleapis";
import { buildAuth, sheetsConfigured, withRetry } from "../store/sheets";
import type { Broadcast, OnlineScriptId, Release } from "./types";

/**
 * 線上主持的場次狀態，整場存成一個 JSON。
 *
 * 跟九爺不同，這裡沒有流水帳要對帳，狀態就是「發了哪些線索給誰、開了哪些幕」，
 * 一場的資料量很小，一列一場最單純。存在同一份 Google Sheet 的「線上場次」分頁。
 */
export interface OnlineSeat {
  nickname: string;
  /** 玩家的通行憑證，存在玩家瀏覽器；重新整理或換手機時用暱稱認回 */
  token: string;
  joinedAt: string;
  /** 玩家輸入代碼自行解鎖的線索 */
  extra: string[];
}

export interface OnlineSession {
  code: string;
  script: OnlineScriptId;
  status: "active" | "ended";
  /** 主持密碼的 SHA-256，不存明文 */
  hostPinHash: string;
  phase: number;
  released: Record<string, Release>;
  unlocks: Record<string, boolean>;
  broadcasts: Broadcast[];
  seats: Record<string, OnlineSeat>;
  createdAt: string;
  updatedAt: string;
  rev: number;
}

export interface OnlineStore {
  readonly kind: "memory" | "sheets";
  get(code: string): Promise<OnlineSession | null>;
  save(session: OnlineSession): Promise<void>;
}

class MemoryOnlineStore implements OnlineStore {
  readonly kind = "memory" as const;
  private map: Map<string, OnlineSession>;

  constructor() {
    const g = globalThis as unknown as { __onlineMem?: Map<string, OnlineSession> };
    this.map = g.__onlineMem ??= new Map();
  }

  async get(code: string) {
    const s = this.map.get(code);
    return s ? structuredClone(s) : null;
  }

  async save(session: OnlineSession) {
    this.map.set(session.code, structuredClone(session));
  }
}

export const ONLINE_TAB = "線上場次";
const HEADERS = ["場次代碼", "劇本", "狀態", "資料", "建立時間", "更新時間"];

function tabRange(a1: string): string {
  return `'${ONLINE_TAB}'!${a1}`;
}

class SheetsOnlineStore implements OnlineStore {
  readonly kind = "sheets" as const;
  private apiInstance: sheets_v4.Sheets | null = null;
  private ready: Promise<void> | null = null;
  /** 場次代碼 → 列號（1-based） */
  private rows = new Map<string, number>();
  private spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? "";

  private get api(): sheets_v4.Sheets {
    this.apiInstance ??= google.sheets({ version: "v4", auth: buildAuth() });
    return this.apiInstance;
  }

  private init(): Promise<void> {
    this.ready ??= this.doInit().catch((err) => {
      // 失敗就讓下一次請求重試，而不是永遠卡在壞掉的 promise
      this.ready = null;
      throw err;
    });
    return this.ready;
  }

  private async doInit(): Promise<void> {
    const meta = await withRetry(() =>
      this.api.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: "sheets.properties.title",
      }),
    );
    const exists = (meta.data.sheets ?? []).some((s) => s.properties?.title === ONLINE_TAB);
    if (!exists) {
      await withRetry(() =>
        this.api.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: { requests: [{ addSheet: { properties: { title: ONLINE_TAB } } }] },
        }),
      );
      await withRetry(() =>
        this.api.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: tabRange("A1"),
          valueInputOption: "RAW",
          requestBody: { values: [HEADERS] },
        }),
      );
    }
    await this.reindex();
  }

  private async reindex(): Promise<void> {
    const res = await withRetry(() =>
      this.api.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: tabRange("A:A"),
      }),
    );
    this.rows.clear();
    (res.data.values ?? []).forEach((r, i) => {
      if (i > 0 && r[0]) this.rows.set(String(r[0]), i + 1);
    });
  }

  async get(code: string): Promise<OnlineSession | null> {
    await this.init();
    if (!this.rows.has(code)) await this.reindex();
    const row = this.rows.get(code);
    if (!row) return null;
    const res = await withRetry(() =>
      this.api.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: tabRange(`A${row}:F${row}`),
      }),
    );
    const values = res.data.values?.[0];
    if (!values || String(values[0]) !== code) {
      // 有人手動插刪了列，索引失準，重建後再讀一次
      await this.reindex();
      const again = this.rows.get(code);
      if (!again || again === row) return null;
      return this.get(code);
    }
    return JSON.parse(String(values[3])) as OnlineSession;
  }

  async save(session: OnlineSession): Promise<void> {
    await this.init();
    const values = [
      [
        session.code,
        session.script,
        session.status === "ended" ? "已結束" : "進行中",
        JSON.stringify(session),
        session.createdAt,
        session.updatedAt,
      ],
    ];
    const row = this.rows.get(session.code);
    if (row) {
      await withRetry(() =>
        this.api.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: tabRange(`A${row}:F${row}`),
          valueInputOption: "RAW",
          requestBody: { values },
        }),
      );
      return;
    }
    await withRetry(() =>
      this.api.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: tabRange("A:F"),
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values },
      }),
    );
    await this.reindex();
  }
}

export function getOnlineStore(): OnlineStore {
  const g = globalThis as unknown as { __onlineStore?: OnlineStore };
  g.__onlineStore ??= sheetsConfigured() ? new SheetsOnlineStore() : new MemoryOnlineStore();
  return g.__onlineStore;
}
