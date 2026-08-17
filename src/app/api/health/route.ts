import { NextResponse } from "next/server";
import { storageMode } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * 健康檢查與設定診斷。
 * 部署後打開 /api/health 就能知道憑證有沒有吃到，不用翻 log。
 * 只回傳布林值與遮蔽後的 ID，不會洩漏任何金鑰內容。
 */
export async function GET() {
  const mode = storageMode();

  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? "";
  const hasJson = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const hasPair = Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY,
  );
  const hasAdcFile = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);

  const problems: string[] = [];
  if (!spreadsheetId) problems.push("缺少 GOOGLE_SHEETS_SPREADSHEET_ID");
  if (!hasJson && !hasPair && !hasAdcFile) {
    problems.push("缺少服務帳號憑證（GOOGLE_SERVICE_ACCOUNT_JSON 或 EMAIL+PRIVATE_KEY）");
  }

  return NextResponse.json(
    {
      ok: true,
      storage: mode,
      // 只露出頭尾各 4 碼，足以確認有沒有貼錯，又不會整串外流
      spreadsheetId: spreadsheetId
        ? `${spreadsheetId.slice(0, 4)}…${spreadsheetId.slice(-4)}（共 ${spreadsheetId.length} 字元）`
        : null,
      credentials: hasJson
        ? "GOOGLE_SERVICE_ACCOUNT_JSON"
        : hasPair
          ? "EMAIL + PRIVATE_KEY"
          : hasAdcFile
            ? "GOOGLE_APPLICATION_CREDENTIALS"
            : null,
      problems,
      hint:
        mode === "memory"
          ? "目前是記憶體模式，資料重啟就會消失。請確認上面 problems 列出的環境變數已設定並重新部署。"
          : "已連上 Google Sheet。",
      time: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
