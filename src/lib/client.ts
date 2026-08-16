"use client";

import type { SessionSnapshot } from "./types";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(
  path: string,
  init: RequestInit & { hostPin?: string; player?: PlayerIdentity | null } = {},
): Promise<T> {
  const { hostPin, player, headers, ...rest } = init;
  const h = new Headers(headers);
  if (rest.body) h.set("content-type", "application/json");
  if (hostPin) h.set("x-host-pin", hostPin);
  if (player) {
    h.set("x-player-id", player.id);
    h.set("x-join-code", player.joinCode);
  }

  let res: Response;
  try {
    res = await fetch(path, { ...rest, headers: h, cache: "no-store" });
  } catch {
    throw new ApiError("NETWORK", "連線失敗，請確認網路後再試一次", 0);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new ApiError(
      data?.code ?? "INTERNAL",
      data?.message ?? `伺服器回應 ${res.status}`,
      res.status,
    );
  }
  return data as T;
}

// ---------------- 瀏覽器端身分保存 ----------------
// 雛形階段用 localStorage 記住身分，正式版建議換成 httpOnly cookie + 後端 session。

export interface PlayerIdentity {
  id: string;
  name: string;
  joinCode: string;
}

const hostKey = (code: string) => `jy:host:${code}`;
const playerKey = (code: string) => `jy:player:${code}`;

function read<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 無痕模式等情況忽略 */
  }
}

export const saveHostPin = (code: string, pin: string) => write(hostKey(code), { pin });
export const loadHostPin = (code: string) => read<{ pin: string }>(hostKey(code))?.pin ?? null;
export const clearHostPin = (code: string) =>
  typeof window !== "undefined" && window.localStorage.removeItem(hostKey(code));

export const savePlayerIdentity = (code: string, p: PlayerIdentity) => write(playerKey(code), p);
export const loadPlayerIdentity = (code: string) => read<PlayerIdentity>(playerKey(code));
export const clearPlayerIdentity = (code: string) =>
  typeof window !== "undefined" && window.localStorage.removeItem(playerKey(code));

export type StateResponse = { ok: true } & SessionSnapshot;
