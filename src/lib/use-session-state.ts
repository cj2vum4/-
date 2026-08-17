"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type PlayerIdentity } from "./client";
import type { HostSnapshot, PlayerSnapshot } from "./types";

interface Options {
  intervalMs?: number;
  enabled?: boolean;
}

interface Auth {
  hostPin?: string;
  player?: PlayerIdentity | null;
}

/**
 * 輪詢場次狀態。
 *
 * 為什麼用輪詢而不是 WebSocket：伺服器端已經有快取，所有玩家的輪詢都打在記憶體上，
 * 對 Google Sheets 的實際讀取次數固定不變；而輪詢在任何部署環境都能跑。
 * 分頁切到背景時自動暫停，回來時立刻補一次。
 *
 * 狀態端點會依身分回傳不同內容，所以一定要帶上驗證資訊。
 */
function useSnapshot<T extends { rev: number }>(
  code: string,
  auth: Auth,
  { intervalMs = 3000, enabled = true }: Options,
) {
  const [snapshot, setSnapshot] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const revRef = useRef(-1);
  const abortRef = useRef<AbortController | null>(null);

  const authKey = `${auth.hostPin ?? ""}|${auth.player?.id ?? ""}|${auth.player?.joinCode ?? ""}`;

  const refresh = useCallback(async () => {
    if (!code) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const data = await api<T & { ok: true }>(`/api/sessions/${code}/state`, {
        signal: ctrl.signal,
        hostPin: auth.hostPin,
        player: auth.player,
      });
      if (ctrl.signal.aborted) return;
      // rev 沒變就不觸發重繪，避免整頁閃動
      if (data.rev !== revRef.current) {
        revRef.current = data.rev;
        setSnapshot(data);
      }
      setError(null);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      if (err instanceof ApiError) setError(err);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
    // authKey already captures the auth values we depend on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, authKey]);

  useEffect(() => {
    if (!enabled || !code) return;

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
    const onVisibility = () => (document.hidden ? stop() : start());

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      abortRef.current?.abort();
    };
  }, [code, enabled, intervalMs, refresh]);

  return { snapshot, error, loading, refresh };
}

export function useHostState(code: string, hostPin: string, opts: Options = {}) {
  return useSnapshot<HostSnapshot>(code, { hostPin }, { intervalMs: 2500, ...opts });
}

export function usePlayerState(
  code: string,
  player: PlayerIdentity | null,
  opts: Options = {},
) {
  return useSnapshot<PlayerSnapshot>(code, { player }, { intervalMs: 3000, ...opts });
}

/**
 * 主持台排序：勢力值優先，其次威望值。
 * 玩家端不能用這個 —— 玩家拿不到別人的勢力值數字，排名由伺服器算好。
 */
export function rankByPower<T extends { power: number; prestige: number; joinedAt: string }>(
  players: T[],
): T[] {
  return [...players].sort(
    (a, b) =>
      b.power - a.power || b.prestige - a.prestige || a.joinedAt.localeCompare(b.joinedAt),
  );
}
