import type { LogEntry, Player, SessionMeta } from "../types";
import type { StoreDriver } from "./driver";

interface Bucket {
  meta: SessionMeta;
  players: Player[];
  log: LogEntry[];
}

/**
 * 純記憶體 driver。沒有設定 Google 憑證時自動啟用，
 * 讓專案 clone 下來就能跑起來看流程；重啟後資料會消失。
 *
 * globalThis 快取是為了讓 Next.js dev 模式熱重載後資料不遺失。
 */
const g = globalThis as unknown as { __jyStore?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (g.__jyStore ??= new Map());

export class MemoryDriver implements StoreDriver {
  readonly kind = "memory" as const;

  async init(): Promise<void> {}

  async listSessions(): Promise<SessionMeta[]> {
    return [...buckets.values()].map((b) => ({ ...b.meta }));
  }

  async getSession(code: string): Promise<SessionMeta | null> {
    const b = buckets.get(code);
    return b ? { ...b.meta } : null;
  }

  async createSession(meta: SessionMeta): Promise<void> {
    buckets.set(meta.code, { meta: { ...meta }, players: [], log: [] });
  }

  async saveSession(meta: SessionMeta): Promise<void> {
    const b = buckets.get(meta.code);
    if (b) b.meta = { ...meta };
  }

  async listPlayers(code: string): Promise<Player[]> {
    return (buckets.get(code)?.players ?? []).map((p) => ({ ...p }));
  }

  async createPlayer(code: string, player: Player): Promise<void> {
    buckets.get(code)?.players.push({ ...player });
  }

  async savePlayers(code: string, players: Player[]): Promise<void> {
    const list = buckets.get(code)?.players;
    if (!list) return;
    for (const player of players) {
      const i = list.findIndex((p) => p.id === player.id);
      if (i >= 0) list[i] = { ...player };
    }
  }

  async listLog(code: string, limit: number): Promise<LogEntry[]> {
    const log = buckets.get(code)?.log ?? [];
    return log.slice(-limit).map((e) => ({ ...e }));
  }

  async appendLogs(code: string, entries: LogEntry[]): Promise<void> {
    const log = buckets.get(code)?.log;
    if (log) log.push(...entries.map((e) => ({ ...e })));
  }
}
