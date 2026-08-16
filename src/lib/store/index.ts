import { MemoryDriver } from "./memory";
import { SheetsDriver, sheetsConfigured } from "./sheets";
import type { StoreDriver } from "./driver";

const g = globalThis as unknown as { __jyDriver?: StoreDriver };

/**
 * 取得儲存層。有設定 Google 憑證就用 Sheets，否則退回記憶體模式，
 * 讓沒有憑證的人也能立刻把雛形跑起來。
 */
export function getDriver(): StoreDriver {
  if (g.__jyDriver) return g.__jyDriver;

  if (sheetsConfigured()) {
    g.__jyDriver = new SheetsDriver();
  } else {
    console.warn(
      "[九爺] 未偵測到 Google Sheets 設定，改用記憶體模式（資料重啟後消失）。" +
        "請參考 .env.example 設定 GOOGLE_SHEETS_SPREADSHEET_ID 與服務帳號憑證。",
    );
    g.__jyDriver = new MemoryDriver();
  }
  return g.__jyDriver;
}

export function storageMode(): "memory" | "sheets" {
  return getDriver().kind;
}
