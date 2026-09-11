import type { LogEntry, Player, Report, SessionMeta, Vote } from "../types";
import type { ArchiveSheet, StoreDriver } from "./driver";

interface Bucket {
  meta: SessionMeta;
  players: Player[];
  reports: Report[];
  votes: Vote[];
  log: LogEntry[];
  /** 封存後的彙整內容，對應 Sheets 的彙整分頁 */
  archive?: (string | number)[][];
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
    buckets.set(meta.code, { meta: { ...meta }, players: [], reports: [], votes: [], log: [] });
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

  async listVotes(code: string): Promise<Vote[]> {
    return (buckets.get(code)?.votes ?? []).map((v) => ({ ...v }));
  }

  async createVote(code: string, vote: Vote): Promise<void> {
    buckets.get(code)?.votes.push({ ...vote });
  }

  async listReports(code: string): Promise<Report[]> {
    return (buckets.get(code)?.reports ?? []).map((r) => ({ ...r }));
  }

  async createReport(code: string, report: Report): Promise<void> {
    buckets.get(code)?.reports.push({ ...report });
  }

  async saveReports(code: string, reports: Report[]): Promise<void> {
    const list = buckets.get(code)?.reports;
    if (!list) return;
    for (const r of reports) {
      const i = list.findIndex((x) => x.id === r.id);
      if (i >= 0) list[i] = { ...r };
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

  /** 記憶體版的封存：留下彙整內容，清掉工作資料，對應 Sheets 刪分頁 */
  async archiveSession(code: string, sheet: ArchiveSheet): Promise<void> {
    const bucket = buckets.get(code);
    if (!bucket) return;
    bucket.archive = sheet.rows.map((r) => [...r]);
    bucket.players = [];
    bucket.reports = [];
    bucket.votes = [];
    bucket.log = [];
  }

  async readArchive(code: string): Promise<(string | number)[][] | null> {
    return buckets.get(code)?.archive?.map((r) => [...r]) ?? null;
  }
}
