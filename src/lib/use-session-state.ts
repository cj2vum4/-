"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type StateResponse } from "./client";
import type { SessionSnapshot } from "./types";

interface Options {
  intervalMs?: number;
  enabled?: boolean;
}

/**
 * 輪詢場次狀態。
 *
 * 為什麼用輪詢而不是 WebSocket：伺服器端已經有快取，所有玩家的輪詢都打在記憶體上，
 * 對 Google Sheets 的實際讀取次數固定不變；而輪詢在任何部署環境（含 serverless）都能跑。
 * 分頁切到背景時自動暫停，回來時立刻補一次。
 */
export function useSessionState(code: string, { intervalMs = 3000, enabled = true }: Options = {}) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const revRef = useRef(-1);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!code) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const data = await api<StateResponse>(`/api/sessions/${code}/state`, {
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      // rev 沒變就不觸發重繪，避免整頁閃動
      if (data.rev !== revRef.current) {
        revRef.current = data.rev;
        setSnapshot({
          session: data.session,
          players: data.players,
          log: data.log,
          rev: data.rev,
          fetchedAt: data.fetchedAt,
        });
      }
      setError(null);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      if (err instanceof ApiError) setError(err);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [code]);

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

/** 依「威望值 → 勢力值 → 加入時間」排名 */
export function rankPlayers<T extends { prestige: number; influence: number; joinedAt: string }>(
  players: T[],
): T[] {
  return [...players].sort(
    (a, b) =>
      b.prestige - a.prestige ||
      b.influence - a.influence ||
      a.joinedAt.localeCompare(b.joinedAt),
  );
}
