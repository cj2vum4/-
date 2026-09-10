import { NextResponse } from "next/server";
import { normalizeSessionCode } from "./date";
import { GameError } from "./errors";

export function jsonOk<T>(data: T): NextResponse {
  return NextResponse.json({ ok: true, ...data }, { headers: { "cache-control": "no-store" } });
}

export function jsonError(err: unknown): NextResponse {
  if (err instanceof GameError) {
    return NextResponse.json(
      { ok: false, code: err.code, message: err.message },
      { status: err.status, headers: { "cache-control": "no-store" } },
    );
  }
  console.error("[九爺] 未預期錯誤", err);
  const message =
    err instanceof Error && err.message ? err.message : "伺服器發生未預期錯誤";
  return NextResponse.json(
    { ok: false, code: "INTERNAL", message },
    { status: 500, headers: { "cache-control": "no-store" } },
  );
}

/** 統一包住 route handler 的 try/catch */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    return jsonError(err);
  }
}

/**
 * 網址上的場次代碼。
 *
 * 代碼是系統產生的：`2026-09-11`，同一天第二場是 `2026-09-11-2`。
 * 玩家與主持人都不用自己打（他們輸入的是開場密碼），這裡只做格式檢查，
 * 避免奇怪的字串被拿去當分頁名稱。
 */
const CODE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:-\d{1,2})?$/;

export function requireCode(raw: string): string {
  const code = decodeURIComponent(raw ?? "").trim();
  if (CODE_PATTERN.test(code)) return code;

  // 舊網址或手動輸入日期時的寬鬆解析，2026/9/11 之類的也接受
  const normalized = normalizeSessionCode(code);
  if (!normalized) throw new GameError("BAD_DATE", "場次代碼格式不正確");
  return normalized;
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new GameError("BAD_REQUEST", "請求格式錯誤");
  }
}

export function hostPin(req: Request): string {
  return req.headers.get("x-host-pin") ?? "";
}

export function playerAuth(req: Request): { playerId: string; joinCode: string } {
  return {
    playerId: req.headers.get("x-player-id") ?? "",
    joinCode: req.headers.get("x-join-code") ?? "",
  };
}
