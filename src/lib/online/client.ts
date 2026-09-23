"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../client";
import type {
  OnlineHostSnapshot,
  OnlinePlayerIdentity,
  OnlinePlayerSnapshot,
} from "./types";

export { ApiError };

export async function onlineApi<T>(
  path: string,
  init: RequestInit & { pin?: string; player?: OnlinePlayerIdentity | null } = {},
): Promise<T> {
  const { pin, player, headers, ...rest } = init;
  const h = new Headers(headers);
  if (rest.body) h.set("content-type", "application/json");
  if (pin) h.set("x-host-pin", pin);
  if (player) {
    h.set("x-role-id", player.roleId);
    h.set("x-player-token", player.token);
  }
  let res: Response;
  try {
    res = await fetch(`/api/online${path}`, { ...rest, headers: h, cache: "no-store" });
  } catch {
    throw new ApiError("NETWORK", "連線失敗，請確認網路後再試一次", 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new ApiError(data?.code ?? "INTERNAL", data?.message ?? `伺服器回應 ${res.status}`, res.status);
  }
  return data as T;
}

// ---- 瀏覽器端身分（換網域後舊的 localStorage 不會跟過來，所以鍵名另開一組） ----

const hostKey = (code: string) => `online:host:${code}`;
const playerKey = (code: string) => `online:player:${code}`;

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 無痕模式寫不進去就算了，重新整理後再輸入一次 */
  }
}

function remove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* 同上 */
  }
}

export const saveHostPin = (code: string, pin: string) => write(hostKey(code), { pin });
export const loadHostPin = (code: string) => read<{ pin: string }>(hostKey(code))?.pin ?? "";
export const clearHostPin = (code: string) => remove(hostKey(code));

export const saveIdentity = (id: OnlinePlayerIdentity) => write(playerKey(id.code), id);
export const loadIdentity = (code: string) => read<OnlinePlayerIdentity>(playerKey(code));
export const clearIdentity = (code: string) => remove(playerKey(code));

/**
 * 輪詢狀態。與九爺同樣的理由用輪詢：任何部署環境都能跑，
 * 狀態都在伺服器記憶體裡，玩家再多也不會多打試算表。
 */
function usePoll<T>(fetcher: (signal: AbortSignal) => Promise<T | null>, intervalMs: number, enabled: boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const next = await fetcherRef.current(ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (next) setData(next);
      setError(null);
    } catch (err) {
      if (!ctrl.signal.aborted && err instanceof ApiError) setError(err);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      void refresh();
      timer = setInterval(() => void refresh(), intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVis = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
      abortRef.current?.abort();
    };
  }, [enabled, intervalMs, refresh]);

  return { data, setData, error, refresh };
}

export function useOnlineHost(code: string, pin: string) {
  return usePoll<OnlineHostSnapshot>(
    async (signal) =>
      (await onlineApi<{ host: OnlineHostSnapshot }>(`/${code}/state`, { pin, signal })).host,
    2500,
    Boolean(pin),
  );
}

export function useOnlinePlayer(identity: OnlinePlayerIdentity | null) {
  const revRef = useRef(0);
  const poll = usePoll<OnlinePlayerSnapshot>(
    async (signal) => {
      if (!identity) return null;
      const r = await onlineApi<{ player?: OnlinePlayerSnapshot; unchanged?: boolean }>(
        `/${identity.code}/state?rev=${revRef.current}`,
        { player: identity, signal },
      );
      if (r.unchanged || !r.player) return null;
      revRef.current = r.player.rev;
      return r.player;
    },
    3000,
    Boolean(identity),
  );
  return poll;
}
