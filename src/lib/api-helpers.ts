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

export function requireCode(raw: string): string {
  const code = normalizeSessionCode(decodeURIComponent(raw ?? ""));
  if (!code) throw new GameError("BAD_DATE", "日期格式無法辨識，請用 2026-08-16 這種寫法");
  return code;
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
