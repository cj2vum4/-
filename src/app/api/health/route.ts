import { NextResponse } from "next/server";
import { diagnoseCredentials } from "@/lib/store/credentials";

export const dynamic = "force-dynamic";

/**
 * 健康檢查與設定診斷。
 *
 * 這支端點必須「永遠」回得了話：它一旦跟著壞掉，就沒有東西能告訴使用者
 * 到底哪裡設定錯了，而 Render 這類平台的健康檢查也會因此判定部署失敗。
 * 所以整段包在 try/catch 裡，並且一律回 200，問題寫在回應內容中。
 */
export async function GET() {
  try {
    // Render 會自動注入這幾個變數，用來確認線上跑的是哪一個 commit
    const commit = process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? null;
    const branch = process.env.RENDER_GIT_BRANCH ?? null;

    const spreadsheetId = (process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? "").trim();
    const cred = diagnoseCredentials();

    const problems: string[] = [];
    if (!spreadsheetId) problems.push("缺少 GOOGLE_SHEETS_SPREADSHEET_ID");
    if (!cred.source) problems.push("缺少服務帳號憑證");
    else if (!cred.ok) problems.push(cred.error ?? "服務帳號憑證格式有問題");

    const usingSheets = Boolean(spreadsheetId) && cred.ok;

    return NextResponse.json(
      {
        ok: problems.length === 0,
        storage: usingSheets ? "sheets" : "memory",
        // 推了新版卻沒看到變化時，先比對這裡的 commit 是不是最新的那一筆
        deployed: { commit: commit ? commit.slice(0, 7) : null, branch },
        spreadsheetId: spreadsheetId
          ? `${spreadsheetId.slice(0, 4)}…${spreadsheetId.slice(-4)}（共 ${spreadsheetId.length} 字元）`
          : null,
        credentials: {
          source: cred.source,
          ok: cred.ok,
          // client_email 不是機密，它本來就要分享給試算表，顯示出來方便核對
          clientEmail: cred.clientEmail ?? null,
          // 解析失敗時描述值的外觀（長度、開頭字元），不含任何金鑰內容
          shape: cred.shape ?? null,
        },
        problems,
        hint: usingSheets
          ? "已連上 Google Sheet。"
          : "目前不會寫入 Google Sheet，資料重啟就消失。請依 problems 修正環境變數後重新部署。",
        time: new Date().toISOString(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    // 即使診斷本身出錯也要回 200，否則平台健康檢查會直接判定失敗
    return NextResponse.json(
      {
        ok: false,
        storage: "unknown",
        problems: ["健康檢查本身發生例外"],
        error: err instanceof Error ? err.message : String(err),
        time: new Date().toISOString(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
