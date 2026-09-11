import { customAlphabet } from "nanoid";
import {
  CHARACTER_MAP,
  FACTIONS,
  HIDDEN_BRANCHES,
  clueOwner,
  normalizeClueCode,
  type Faction,
  type HiddenBranch,
} from "./characters";
import {
  ASSISTANT_POWER,
  ASSISTANT_TITLE,
  AUCTION_LOT_MAP,
  DEFAULT_LEDGER_SOURCE,
  DEFAULT_STAGE,
  INITIAL_PRESTIGE,
  LOG_TAIL,
  RESOURCE_MAP,
  STAGE_MAP,
  VOTE_APPROVE_COUNT,
  VOTE_OPPOSE_COUNT,
  VOTE_PRESTIGE,
  positionForRank,
  titleForRank,
  type LedgerSource,
} from "./config";
import { GameError } from "./errors";
import { scriptFaction } from "./script-factions";
import {
  RECRUIT_POOLS,
  SKILL_CARDS,
  buildPool,
  drawsForRank,
  parseToken,
} from "./recruit";
import { getDriver } from "./store";
import type {
  Certificate,
  HostSnapshot,
  MyReportView,
  Report,
  ReportVerdict,
  LogEntry,
  LogType,
  Vote,
  VoteKind,
  VoteProgress,
  Player,
  PlayerSnapshot,
  PublicPlayerView,
  ResourceKey,
  SelfPlayerView,
  SessionMeta,
  RevealedClue,
  SessionPublicMeta,
  SessionStatus,
} from "./types";

const nanoId = customAlphabet("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 6);
const nanoCode = customAlphabet("0123456789", 4);

/** 快取存活時間：超過就重新從 Sheets 拉一次，順便撈到主持人手動改表的內容 */
const CACHE_TTL_MS = Number(process.env.SESSION_CACHE_TTL_MS ?? 15_000);

interface CacheEntry {
  session: SessionMeta;
  players: Player[];
  reports: Report[];
  votes: Vote[];
  log: LogEntry[];
  rev: number;
  loadedAt: number;
}

const g = globalThis as unknown as {
  __jyCache?: Map<string, CacheEntry>;
  __jyLocks?: Map<string, Promise<unknown>>;
  __jyRefreshing?: Set<string>;
};
const cache: Map<string, CacheEntry> = (g.__jyCache ??= new Map());

/**
 * 場次列（含招募彩池）的延後寫入。
 *
 * 抽招募時每次都寫回彩池的話，49 次抽取就是 49 次寫入，
 * 加上玩家與紀錄會直接撞爆 Sheets 每分鐘 60 次的寫入配額。
 * 玩家餘額與流水帳仍即時寫入（那些不能掉），彩池則合併成幾秒一次；
 * 最壞情況是伺服器在這幾秒內掛掉，重啟後有少數幾張牌重複進池。
 */
const SESSION_SAVE_DEBOUNCE_MS = 4000;
const pendingSessionSaves = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleSessionSave(code: string): void {
  if (pendingSessionSaves.has(code)) return;
  const timer = setTimeout(() => {
    pendingSessionSaves.delete(code);
    void withLock(code, async () => {
      const entry = cache.get(code);
      if (entry) await getDriver().saveSession(entry.session);
    }).catch((err) => console.error("[九爺] 延後寫入場次失敗", code, err));
  }, SESSION_SAVE_DEBOUNCE_MS);
  pendingSessionSaves.set(code, timer);
}

/** 有需要立刻落地時（例如切換階段）先取消排程，避免寫兩次 */
function cancelScheduledSessionSave(code: string): boolean {
  const timer = pendingSessionSaves.get(code);
  if (!timer) return false;
  clearTimeout(timer);
  pendingSessionSaves.delete(code);
  return true;
}

/**
 * 把待寫的彩池立刻落地。
 *
 * 重新載入前一定要先呼叫這支：否則會從試算表讀回還沒更新的舊彩池，
 * 把記憶體中已經抽掉幾張的正確狀態蓋掉——等於憑空多出幾張牌。
 * 只能在鎖內呼叫。
 */
async function flushSessionSave(code: string): Promise<void> {
  if (!cancelScheduledSessionSave(code)) return;
  const entry = cache.get(code);
  if (entry) await getDriver().saveSession(entry.session);
}
const locks: Map<string, Promise<unknown>> = (g.__jyLocks ??= new Map());
const refreshing: Set<string> = (g.__jyRefreshing ??= new Set());

/**
 * 同一個場次的所有存取都串成一條鏈。
 *
 * 不只寫入要鎖 —— 背景重新整理也必須走這條鏈。否則會發生：
 * 刷新在 t0 讀到舊餘額 → t1 有人發放並寫回 → t2 刷新結果蓋掉快取 →
 * 下一筆發放從被蓋掉的舊值往上加，前一筆就消失了（lost update）。
 */
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    key,
    next.catch(() => {}),
  );
  return next;
}

async function loadEntry(code: string): Promise<CacheEntry> {
  // 先把延後寫入的彩池落地，再讀，避免讀回舊狀態
  await flushSessionSave(code);
  const driver = getDriver();
  const session = await driver.getSession(code);
  if (!session) {
    cache.delete(code);
    throw new GameError("SESSION_NOT_FOUND", "無此場次");
  }

  // 已封存的場次三個工作分頁都刪了。這裡若照常去讀，ensureTab 會把空分頁
  // 重新建回來，看起來就像資料被清空——所以直接回空的，不碰儲存層。
  const [players, reports, votes, log] = session.archived
    ? [[] as Player[], [] as Report[], [] as Vote[], [] as LogEntry[]]
    : await Promise.all([
        driver.listPlayers(code),
        driver.listReports(code).catch(() => [] as Report[]),
        driver.listVotes(code).catch(() => [] as Vote[]),
        driver.listLog(code, LOG_TAIL),
      ]);

  const entry: CacheEntry = {
    session,
    players,
    reports,
    votes,
    log,
    rev: (cache.get(code)?.rev ?? 0) + 1,
    loadedAt: Date.now(),
  };
  cache.set(code, entry);
  return entry;
}

/** 鎖內使用：快取有就用，沒有才載入。絕不觸發背景刷新，避免等待同一把鎖。 */
async function getEntryLocked(code: string): Promise<CacheEntry> {
  return cache.get(code) ?? loadEntry(code);
}

/** 讀取路徑使用（未持鎖）。命中快取立刻回傳，過期則在鎖內背景刷新。 */
async function getEntry(code: string): Promise<CacheEntry> {
  const hit = cache.get(code);
  if (!hit) return withLock(code, () => loadEntry(code));

  if (Date.now() - hit.loadedAt > CACHE_TTL_MS && !refreshing.has(code)) {
    refreshing.add(code);
    void withLock(code, () => loadEntry(code))
      .catch((err) => console.error("[九爺] 背景重新整理失敗", code, err))
      .finally(() => refreshing.delete(code));
  }
  return hit;
}

function pushLog(entry: CacheEntry, ...logs: LogEntry[]): void {
  entry.log.push(...logs);
  if (entry.log.length > LOG_TAIL) entry.log.splice(0, entry.log.length - LOG_TAIL);
  entry.rev += 1;
}

function makeLog(
  partial: Partial<LogEntry> & { type: LogType; publicVisible: boolean },
): LogEntry {
  return {
    ts: new Date().toISOString(),
    playerId: "",
    playerName: "",
    resource: "",
    delta: "",
    balanceAfter: "",
    source: "",
    reason: "",
    operator: "",
    ...partial,
  };
}

/** 已發放的聘書；未發放時為 null */
function buildCertificate(player: Player, code: string): Certificate | null {
  if (!player.certRank) return null;
  return {
    rank: player.certRank,
    nickname: player.nickname,
    characterName: player.name,
    position: positionForRank(player.certRank),
    title: titleForRank(player.certRank),
    date: code,
  };
}

/** 舉報成立並結算後，線索卡對全場公開 */
function revealedClues(entry: CacheEntry): RevealedClue[] {
  return entry.reports
    .filter((r) => r.settled && r.verdict === "success")
    .map((r) => ({ code: r.clueCode, ownerName: r.targetName }));
}

/**
 * 線索卡是否還能用。
 * 使用中（尚未結算）或已成立公開的都不能再用；
 * 舉報失敗且已結算的會釋放回來，可以再次舉報。
 */
function clueAvailable(entry: CacheEntry, clueCode: string): boolean {
  return !entry.reports.some(
    (r) => r.clueCode === clueCode && (!r.settled || r.verdict === "success"),
  );
}

function publicMeta(s: SessionMeta): SessionPublicMeta {
  const stage = STAGE_MAP[s.stageId];
  return {
    code: s.code,
    title: s.title,
    status: s.status,
    stageId: s.stageId,
    // 由階段推導而非讀儲存值：改版前建立的場次不會卡在舊旗標上
    recruitOpen: stage?.autoRecruit ?? false,
    hasVote: stage?.hasVote ?? false,
    updatedAt: s.updatedAt,
    peerPower: stage?.peerPower ?? "hidden",
    showPrestige: stage?.showPrestige ?? false,
    certsIssued: s.certsIssued,
  };
}

/**
 * 勢力值名次（1 起算，同分同名次）。
 * 玩家之間只看得到名次，看不到彼此的勢力值數字。
 */
function powerRanks(players: Player[]): Map<string, number> {
  const sorted = [...players].sort((a, b) => b.power - a.power);
  const ranks = new Map<string, number>();
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    ranks.set(p.id, prev && prev.power === p.power ? ranks.get(prev.id)! : i + 1);
  });
  return ranks;
}

// ---------------- 場次 ----------------

/** 今天的日期，YYYY-MM-DD */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * 產生場次代碼：當天日期，同一天開第二場就加序號。
 *
 * 這個代碼同時是封存後的分頁名稱，所以「一天一場」時分頁名就是乾淨的日期。
 */
function nextCode(existing: Set<string>): string {
  const base = today();
  if (!existing.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new GameError("BAD_REQUEST", "今天開的場次太多了");
}

export async function createSession(input: {
  password: string;
  title?: string;
}): Promise<SessionMeta> {
  const password = input.password.trim();
  if (password.length < 4) {
    throw new GameError("BAD_REQUEST", "開場密碼至少 4 個字，玩家要用同一組進場");
  }
  if (password.length > 30) {
    throw new GameError("BAD_REQUEST", "開場密碼請控制在 30 字以內");
  }

  const driver = getDriver();
  const all = await driver.listSessions();

  // 同一組密碼不能同時有兩場還開著，否則玩家不知道會進到哪一場
  const clash = all.find((s) => !s.archived && s.status !== "closed" && s.password === password);
  if (clash) {
    throw new GameError("SESSION_EXISTS", "這組密碼已經有一場正在進行，請換一組");
  }

  const code = nextCode(new Set(all.map((s) => s.code)));

  return withLock(code, async () => {
    const now = new Date().toISOString();
    const meta: SessionMeta = {
      code,
      title: input.title?.trim() || `${code} 場次`,
      status: "open",
      stageId: DEFAULT_STAGE,
      recruitOpen: false,
      poolStage: "",
      pool: [],
      certsIssued: false,
      archived: false,
      password,
      createdAt: now,
      updatedAt: now,
    };

    await driver.createSession(meta);
    await driver.appendLogs(code, [
      makeLog({
        type: "session",
        reason: `開啟場次「${meta.title}」`,
        operator: "主持人",
        publicVisible: true,
      }),
    ]);

    cache.delete(code);
    await loadEntry(code);
    return meta;
  });
}

/**
 * 用開場密碼找場次。玩家與主持人都走這裡。
 *
 * 只認還開著的場次：已結束或已封存的場次，密碼就失效了，
 * 不然隔週用同一組密碼會誤入上一場。
 */
export async function findByPassword(password: string): Promise<SessionMeta> {
  const pw = (password ?? "").trim();
  if (!pw) throw new GameError("BAD_REQUEST", "請輸入開場密碼");

  const all = await getDriver().listSessions();
  const hit = all.find((s) => s.password === pw && !s.archived && s.status !== "closed");
  if (!hit) throw new GameError("SESSION_NOT_FOUND", "無此場次");
  return hit;
}

/** 讀場次設定。會走快取，不額外打儲存層。 */
export async function getSessionMeta(code: string): Promise<SessionMeta> {
  return (await getEntry(code)).session;
}

/** 玩家輸入場次時用的檢查，找不到就是「無此場次」 */
export async function findSession(code: string): Promise<SessionMeta> {
  const session = (await getEntry(code)).session;
  if (session.archived) {
    throw new GameError("SESSION_NOT_FOUND", "本場次已封存，資料在試算表的彙整分頁");
  }
  return session;
}

export async function listSessions(): Promise<Array<Omit<SessionMeta, "password">>> {
  const all = await getDriver().listSessions();
  return all.map(({ password: _password, ...rest }) => rest);
}

/** 哪些角色還沒被選走 */
export async function availableCharacters(code: string): Promise<string[]> {
  const entry = await getEntry(code);
  const taken = new Set(
    entry.players.filter((p) => p.status === "active").map((p) => p.characterId),
  );
  return Object.keys(CHARACTER_MAP).filter((id) => !taken.has(id));
}

/**
 * 主持人驗證。目前用的是開場密碼——跟玩家同一組（依需求簡化）。
 *
 * ⚠️ 這代表知道密碼的玩家也進得了主持台。若要分開，這裡改比對
 * session.hostPin 即可，呼叫端一律不用動。
 */
export async function assertHost(code: string, pin: string): Promise<SessionMeta> {
  const entry = await getEntry(code);
  if (entry.session.archived) {
    throw new GameError("SESSION_NOT_FOUND", "本場次已封存，無法再操作");
  }
  if (!pin || entry.session.password !== pin) {
    throw new GameError("UNAUTHORIZED", "開場密碼不正確");
  }
  return entry.session;
}

export async function assertPlayer(
  code: string,
  playerId: string,
  joinCode: string,
): Promise<Player> {
  const entry = await getEntry(code);
  const player = entry.players.find((p) => p.id === playerId);
  if (!player || player.status !== "active") {
    throw new GameError("PLAYER_NOT_FOUND", "找不到你的角色，請重新入場");
  }
  if (player.joinCode !== joinCode) {
    throw new GameError("UNAUTHORIZED", "通行碼不正確");
  }
  return player;
}

// ---------------- 快照（依身分決定看得到什麼） ----------------

export async function getHostSnapshot(code: string): Promise<HostSnapshot> {
  const entry = await getEntry(code);
  return {
    view: "host",
    session: publicMeta(entry.session),
    players: entry.players.filter((p) => p.status === "active"),
    // 最新的舉報排前面，主持人才好處理待判定的
    reports: [...entry.reports].reverse(),
    revealedClues: revealedClues(entry),
    poolLeft: entry.session.pool.length,
    // 劇本原訂的陣營，讓主持台標出「這個人被改過」。只給主持人，不進玩家端
    scriptFactions: Object.fromEntries(
      entry.players.map((p) => [p.characterId, scriptFaction(p.characterId)]),
    ),
    // 只給「還剩幾張」，不給票型——主持人在紀錄分頁才看得到誰投給誰
    voteProgress: voteProgress(entry),
    allVotesCast: allVotesCast(entry),
    log: [...entry.log].reverse(),
    rev: entry.rev,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 別人的紀錄裡，玩家看得到的類型。
 *
 * 用白名單而不是黑名單：之後新增紀錄類型時，預設是「別人看不到」，
 * 忘了設可見性也不會外洩。這幾種是現場本來就看得見的事——
 * 誰入場了、誰被請出去了、誰拿到聘書。
 */
const PEER_VISIBLE_TYPES = new Set<LogType>(["join", "note", "cert"]);

/**
 * 這筆紀錄能不能給這位玩家看。
 *
 * 自己的全都看得到；場次層級的事件（開場、換階段）照 publicVisible；
 * 別人的則只有白名單類型、而且不能夾帶數值變動。
 *
 * 為什麼連威望值的變動都要擋：威望在榜單上是公開的沒錯，但動態裡出現
 * 「某某 威望值 −1」就等於公布他被舉報成立、或被構陷了，而依規則
 * 「公布時不顯示明細，只顯示數字的結果」。招募次數同理，那等於把威望排名攤開。
 */
function visibleToPlayer(e: LogEntry, playerId: string): boolean {
  if (e.playerId === playerId) return true;
  if (!e.playerId) return e.publicVisible;
  return e.publicVisible && PEER_VISIBLE_TYPES.has(e.type) && !e.resource;
}

/**
 * 玩家視角。這裡是全系統最需要小心的地方：
 * 勢力值與血量只能給本人，其他人一律只給威望值與勢力值名次。
 */
export async function getPlayerSnapshot(
  code: string,
  playerId: string,
): Promise<PlayerSnapshot> {
  const entry = await getEntry(code);
  const active = entry.players.filter((p) => p.status === "active");
  const me = active.find((p) => p.id === playerId);
  if (!me) throw new GameError("PLAYER_NOT_FOUND", "找不到你的角色，請重新入場");

  const stage = STAGE_MAP[entry.session.stageId];
  const peerPower = stage?.peerPower ?? "hidden";
  const showPrestige = stage?.showPrestige ?? false;
  const ranks = powerRanks(active);

  /**
   * 可見度隨階段變動，所以這裡是逐欄位決定要不要放進回應。
   * 不該看到的欄位在後端就不存在，不是靠前端隱藏。
   */
  const toPublic = (p: Player): PublicPlayerView => {
    const view: PublicPlayerView = {
      id: p.id,
      characterId: p.characterId,
      name: p.name,
      status: p.status,
    };
    if (peerPower === "value") {
      view.power = p.power;
      view.powerRank = ranks.get(p.id);
    }
    if (showPrestige) view.prestige = p.prestige;
    return view;
  };

  const self: SelfPlayerView = {
    id: me.id,
    characterId: me.characterId,
    name: me.name,
    status: me.status,
    // 自己的勢力值與血量任何階段都看得到
    power: me.power,
    hp: me.hp,
    hiddenBranch: me.hiddenBranch,
    drawsRemaining: me.drawsRemaining,
    heldCards: [...me.heldCards],
    nickname: me.nickname,
    certificate: buildCertificate(me, code),
  };
  if (stage?.hasVote) {
    const progress = voteProgress(entry).find((v) => v.playerId === me.id);
    self.votesLeft = {
      approve: progress?.approveLeft ?? 0,
      oppose: progress?.opposeLeft ?? 0,
    };
    // 只給自己投過誰，別人的票型一概不給
    self.votedTargetIds = entry.votes
      .filter((v) => v.voterId === me.id)
      .map((v) => v.targetId);
  }
  if (showPrestige) self.prestige = me.prestige;
  // 名次會洩漏他人勢力值的相對高低，所以只在勢力值本來就公開時才給
  if (peerPower === "value") self.powerRank = ranks.get(me.id);

  // 只給自己送出的舉報，且結算前不揭露判定結果
  const myReports: MyReportView[] = entry.reports
    .filter((r) => r.reporterId === playerId)
    .map((r) => ({
      id: r.id,
      ts: r.ts,
      targetName: r.targetName,
      clueCode: r.clueCode,
      verdict: r.settled ? r.verdict : "",
      settled: r.settled,
    }))
    .reverse();

  return {
    view: "player",
    session: publicMeta(entry.session),
    me: self,
    players: active.map(toPublic),
    myReports,
    revealedClues: revealedClues(entry),
    log: [...entry.log]
      .filter((e) => visibleToPlayer(e, playerId))
      // 威望相關的紀錄在第一週前不該出現
      .filter((e) => showPrestige || e.resource !== "威望值")
      // 來源類型只給主持台。玩家端從來不顯示它，留在 JSON 裡只會洩漏
      // 「這 −1 是舉報來的」這種依規則不該公布的明細
      .map(({ source: _hidden, ...rest }): LogEntry => ({ ...rest, source: "" }))
      .reverse(),
    rev: entry.rev,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------- 階段與場次控制 ----------------

export async function setStage(code: string, stageId: string): Promise<SessionMeta> {
  const stage = STAGE_MAP[stageId];
  if (!stage) throw new GameError("BAD_REQUEST", "未知的階段");

  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    const from = STAGE_MAP[entry.session.stageId];
    const leavingVote = Boolean(from?.hasVote) && stageId !== entry.session.stageId;

    // 票沒投完不讓走。結算要靠完整票型，缺一張結果就不對了。
    if (leavingVote && !allVotesCast(entry)) {
      const waiting = voteProgress(entry).filter((p) => p.totalLeft > 0);
      throw new GameError(
        "BAD_REQUEST",
        `還有 ${waiting.length} 位玩家沒投完票（${waiting
          .map((p) => `${p.playerName} 剩 ${p.totalLeft} 張`)
          .join("、")}），投完才能進入下一階段`,
      );
    }

    // 招募狀態由階段設定決定：第一週起自動開啟，主持人不必手動開
    const next: SessionMeta = {
      ...entry.session,
      stageId,
      recruitOpen: stage.autoRecruit ?? false,
      updatedAt: new Date().toISOString(),
    };
    const logs: LogEntry[] = [];

    // 1. 上一階段沒用完的抽取次數要先抽完，否則彩池會累積到下一輪而超額
    //    （彩池張數剛好等於全員抽取次數的總和）
    logs.push(...autoDrawLeftovers(entry));

    // 2. 舉報結果與威望值變動在切換階段時公布
    logs.push(...(await settlePendingReports(entry)));

    // 3. 離開第一週時結算票型：加減威望，並選出會長助理。
    //    綁在「離開」而不是「進入第二週」，主持人若直接跳到第三週也不會漏算。
    if (leavingVote) {
      logs.push(...settleVotes(entry));
    }

    logs.push(
      makeLog({
        type: "stage",
        reason: `進入階段 ${stage.index}：${stage.label}`,
        operator: "主持人",
        publicVisible: true,
      }),
    );

    // 4. 重建彩池並依（結算後的）威望排名發放抽取次數
    if (RECRUIT_POOLS[stageId]) {
      next.poolStage = stageId;
      next.pool = buildPool(stageId);
    }
    if (stage.grantsDraws) {
      logs.push(...grantDraws(entry, stage.label));
    }

    cancelScheduledSessionSave(code);
    await getDriver().saveSession(next);
    await getDriver().savePlayers(
      code,
      entry.players.filter((p) => p.status === "active"),
    );
    await getDriver().appendLogs(code, logs);

    entry.session = next;
    pushLog(entry, ...logs);
    return next;
  });
}

/**
 * 依威望排名發放本階段的抽取次數。
 *
 * 名次用「序位」而非「並列」——七人各自拿到 1..7，總次數才會剛好等於彩池的 49 張。
 * 同分時以加入場次的先後決定，結果是確定性的。
 */
function grantDraws(entry: CacheEntry, stageLabel: string): LogEntry[] {
  const active = entry.players.filter((p) => p.status === "active");
  const ordered = [...active].sort(
    (a, b) => b.prestige - a.prestige || a.joinedAt.localeCompare(b.joinedAt),
  );

  const now = new Date().toISOString();
  return ordered.map((player, i) => {
    const rank = i + 1;
    const draws = drawsForRank(rank);
    player.drawsRemaining = draws;
    player.updatedAt = now;
    return makeLog({
      type: "recruit",
      playerId: player.id,
      playerName: player.name,
      reason: `${stageLabel}：威望第 ${rank} 名，獲得 ${draws} 次招募機會`,
      operator: "系統",
      // 只給本人。抽取次數等於把威望排名攤開講，別人不該從動態看到
      publicVisible: false,
    });
  });
}

/** 把剩餘次數在換階段前抽完，並記錄結果。只能在鎖內呼叫。 */
function autoDrawLeftovers(entry: CacheEntry): LogEntry[] {
  const logs: LogEntry[] = [];
  for (const player of entry.players) {
    while (player.drawsRemaining > 0 && entry.session.pool.length > 0) {
      logs.push(...applyDraw(entry, player, true));
    }
    // 彩池空了就把剩餘次數歸零，避免帶到下一階段
    player.drawsRemaining = 0;
  }
  return logs;
}

/**
 * 從彩池抽一張並套用。勢力值立即入帳；技能卡先收進手上，之後選目標再使用。
 * 只能在鎖內呼叫，且呼叫端負責寫回資料庫。
 */
function applyDraw(entry: CacheEntry, player: Player, auto = false): LogEntry[] {
  const token = entry.session.pool.shift();
  if (!token) return [];

  player.drawsRemaining = Math.max(0, player.drawsRemaining - 1);
  player.updatedAt = new Date().toISOString();

  const parsed = parseToken(token);
  const prefix = auto ? "（未用完自動抽取）" : "";

  if (parsed?.kind === "power") {
    player.power += parsed.amount;
    return [
      makeLog({
        type: "recruit",
        playerId: player.id,
        playerName: player.name,
        resource: "勢力值",
        delta: parsed.amount,
        balanceAfter: player.power,
        source: "勢力招募抽取",
        reason: `${prefix}招募所得`,
        operator: "系統",
        // 勢力值是機密，只有本人看得到
        publicVisible: false,
      }),
    ];
  }

  if (parsed?.kind === "skill") {
    player.heldCards.push(parsed.card.id);
    return [
      makeLog({
        type: "skill",
        playerId: player.id,
        playerName: player.name,
        source: "勢力招募抽取",
        reason: `${prefix}抽中技能卡「${parsed.card.name}」`,
        operator: "系統",
        publicVisible: false,
      }),
    ];
  }
  return [];
}


export async function setRecruitOpen(code: string, open: boolean): Promise<SessionMeta> {
  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    const stage = STAGE_MAP[entry.session.stageId];
    if (open && !stage?.hasRecruit) {
      throw new GameError("BAD_REQUEST", `「${stage?.label ?? entry.session.stageId}」沒有勢力招募`);
    }

    const next: SessionMeta = {
      ...entry.session,
      recruitOpen: open,
      updatedAt: new Date().toISOString(),
    };
    const log = makeLog({
      type: "recruit",
      reason: open ? `開啟招募：${stage?.label}` : `鎖定招募：${stage?.label}`,
      operator: "主持人",
      publicVisible: true,
    });

    await getDriver().saveSession(next);
    await getDriver().appendLogs(code, [log]);

    entry.session = next;
    pushLog(entry, log);
    return next;
  });
}

/**
 * 結算所有「已判定但尚未生效」的舉報。
 * 成功→被舉報人威望 -1；失敗（誤舉報）→舉報人自己威望 -1。
 * 只能在鎖內呼叫。
 */
async function settlePendingReports(entry: CacheEntry): Promise<LogEntry[]> {
  const pending = entry.reports.filter((r) => r.verdict !== "" && !r.settled);
  if (pending.length === 0) return [];

  const now = new Date().toISOString();
  const logs: LogEntry[] = [];
  const touched = new Map<string, Player>();

  for (const report of pending) {
    const loserId = report.verdict === "success" ? report.targetId : report.reporterId;
    const player = entry.players.find((p) => p.id === loserId);
    if (!player) continue;

    const current = touched.get(player.id) ?? { ...player };
    current.prestige -= 1;
    current.updatedAt = now;
    touched.set(player.id, current);

    // 依規則「公布時不顯示明細，只顯示數字的結果」：
    // 事由留白，只留下威望值的變動數字。誰舉報了誰不會出現在任何玩家看得到的地方。
    logs.push(
      makeLog({
        type: "report",
        playerId: player.id,
        playerName: player.name,
        resource: "威望值",
        delta: -1,
        balanceAfter: current.prestige,
        source: "舉報懲罰",
        // 依規則「公布時不顯示明細，只顯示數字的結果」：事由完全留白。
        // 來源類型只出現在主持台（LogFeed 的 showSource），玩家端看不到。
        reason: "",
        operator: "系統",
        // 只給本人。別人看到「某某 威望值 −1」就等於知道他被舉報成立了
        publicVisible: false,
      }),
    );
  }

  const settled = pending.map((r) => ({ ...r, settled: true, settledAt: now }));
  const updatedPlayers = [...touched.values()];

  const driver = getDriver();
  await Promise.all([
    updatedPlayers.length ? driver.savePlayers(entry.session.code, updatedPlayers) : null,
    driver.saveReports(entry.session.code, settled),
  ]);

  for (const p of updatedPlayers) {
    const live = entry.players.find((x) => x.id === p.id);
    if (live) Object.assign(live, p);
  }
  for (const r of settled) {
    const live = entry.reports.find((x) => x.id === r.id);
    if (live) Object.assign(live, r);
  }
  return logs;
}

export async function setSessionStatus(
  code: string,
  status: SessionStatus,
): Promise<SessionMeta> {
  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    if (entry.session.archived) {
      throw new GameError("BAD_REQUEST", "本場次已封存，不能再改狀態");
    }

    const next: SessionMeta = {
      ...entry.session,
      status,
      updatedAt: new Date().toISOString(),
    };
    const label = status === "open" ? "重新開放" : status === "paused" ? "暫停" : "結束";
    const log = makeLog({
      type: "session",
      reason: `場次${label}`,
      operator: "主持人",
      publicVisible: true,
    });

    await getDriver().saveSession(next);
    await getDriver().appendLogs(code, [log]);

    entry.session = next;
    pushLog(entry, log);

    // 結束就順手收攤：三個工作分頁彙整成一個以日期命名的分頁再刪掉。
    // 場次一多，每場三個分頁很快就找不到東西。
    if (status === "closed") {
      await archiveLocked(entry);
    }
    return entry.session;
  });
}

/**
 * 封存。只能在鎖內呼叫。
 *
 * 先把完整內容排版好寫進彙整分頁，成功了才刪工作分頁——中途失敗最多是多一個
 * 分頁，不會弄丟資料。
 */
async function archiveLocked(entry: CacheEntry): Promise<void> {
  const code = entry.session.code;

  // 流水帳的快取只留最近 LOG_TAIL 筆，封存要完整的，所以重讀一次
  const fullLog = await getDriver()
    .listLog(code, Number.MAX_SAFE_INTEGER)
    .catch(() => entry.log);

  await getDriver().archiveSession(code, {
    rows: buildArchiveRows(entry, fullLog),
  });

  const next: SessionMeta = {
    ...entry.session,
    archived: true,
    updatedAt: new Date().toISOString(),
  };
  await getDriver().saveSession(next);

  entry.session = next;
  entry.players = [];
  entry.reports = [];
  entry.votes = [];
  entry.log = [];
}

/** 把一場的所有資料排成一張表。分區塊，人看得懂為主。 */
function buildArchiveRows(entry: CacheEntry, log: LogEntry[]): (string | number)[][] {
  const { session, players, reports } = entry;
  const stage = STAGE_MAP[session.stageId];
  const rows: (string | number)[][] = [
    ["場次", session.code],
    ["名稱", session.title],
    ["開場密碼", session.password],
    ["最終階段", stage ? `${stage.index}・${stage.label}` : session.stageId],
    ["建立時間", session.createdAt],
    ["結束時間", session.updatedAt],
    [],
    ["【玩家】"],
    [
      "玩家代碼", "角色", "暱稱", "聘書名次", "職位", "稱號",
      "真實陣營", "隱藏分支", "勢力值", "威望值", "血量", "狀態", "加入時間",
    ],
  ];

  const ordered = [...players].sort(
    (a, b) => (a.certRank || 99) - (b.certRank || 99) || b.power - a.power,
  );
  for (const p of ordered) {
    rows.push([
      p.id,
      p.name,
      p.nickname,
      p.certRank || "",
      p.certRank ? positionForRank(p.certRank) : "",
      p.certRank ? titleForRank(p.certRank) : "",
      p.faction,
      p.hiddenBranch,
      p.power,
      p.prestige,
      p.hp,
      p.status,
      p.joinedAt,
    ]);
  }

  rows.push([], ["【舉報】"]);
  if (reports.length === 0) {
    rows.push(["（無）"]);
  } else {
    rows.push(["時間", "舉報人", "被舉報人", "線索卡", "判定", "已生效"]);
    for (const r of reports) {
      rows.push([
        r.ts,
        r.reporterName,
        r.targetName,
        r.clueCode,
        r.verdict === "success" ? "成立" : r.verdict === "fail" ? "不成立" : "未判定",
        r.settled ? "是" : "否",
      ]);
    }
  }

  rows.push([], ["【投票】"]);
  if (entry.votes.length === 0) {
    rows.push(["（無）"]);
  } else {
    rows.push(["時間", "投票人", "被投人", "票種"]);
    for (const v of entry.votes) {
      rows.push([v.ts, v.voterName, v.targetName, v.kind === "approve" ? "同意" : "不同意"]);
    }
  }

  rows.push([], ["【流水帳】"]);
  rows.push(["時間", "類型", "角色", "資源", "變動", "變動後", "來源", "事由", "操作者"]);
  for (const e of log) {
    rows.push([
      e.ts,
      e.type,
      e.playerName,
      e.resource,
      e.delta,
      e.balanceAfter,
      e.source,
      e.reason,
      e.operator,
    ]);
  }

  return rows;
}

// ---------------- 玩家 ----------------

export async function joinSession(
  code: string,
  characterId: string,
  nickname: string,
): Promise<Player> {
  const nick = nickname.trim();
  if (!nick) throw new GameError("BAD_REQUEST", "請輸入你的暱稱");
  if (nick.length > 20) throw new GameError("BAD_REQUEST", "暱稱請控制在 20 字以內");

  const character = CHARACTER_MAP[characterId];
  if (!character) throw new GameError("BAD_REQUEST", "沒有這個角色");

  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    if (entry.session.status === "closed") {
      throw new GameError("SESSION_CLOSED", "本場次已結束");
    }

    const stage = STAGE_MAP[entry.session.stageId];
    if (stage && !stage.allowJoin) {
      throw new GameError("JOIN_CLOSED", `目前為「${stage.label}」階段，已不開放入場`);
    }

    if (entry.players.some((p) => p.status === "active" && p.characterId === characterId)) {
      throw new GameError("NAME_TAKEN", `「${character.name}」已經有人選了，請換一位`);
    }

    const now = new Date().toISOString();
    const player: Player = {
      id: `P${nanoId()}`,
      characterId,
      name: character.name,
      joinCode: nanoCode(),
      // 陣營由劇本固定，入場就套用，主持人不必一個個設
      faction: scriptFaction(characterId),
      hiddenBranch: "",
      hiddenBranchLocked: false,
      power: 0,
      // 依規則每個人的威望值初始為 10
      prestige: INITIAL_PRESTIGE,
      hp: 0,
      drawsRemaining: 0,
      heldCards: [],
      status: "active",
      joinedAt: now,
      updatedAt: now,
      nickname: nick,
      certRank: 0,
    };
    const log = makeLog({
      type: "join",
      playerId: player.id,
      playerName: player.name,
      reason: `入府報到（${nick}）`,
      operator: "系統",
      publicVisible: true,
    });

    await getDriver().createPlayer(code, player);
    await getDriver().appendLogs(code, [log]);

    entry.players.push(player);
    pushLog(entry, log);
    return player;
  });
}

/**
 * 玩家補填或修改自己的暱稱。
 *
 * 暱稱是新加的欄位，改版前入場的玩家一定是空的；沒有這個入口他們就永遠拿不到聘書。
 * 聘書發放後不再開放修改，免得證書上的名字跟紀錄對不起來。
 */
export async function setNickname(
  code: string,
  playerId: string,
  nickname: string,
): Promise<{ nickname: string }> {
  const nick = nickname.trim();
  if (!nick) throw new GameError("BAD_REQUEST", "請輸入你的暱稱");
  if (nick.length > 20) throw new GameError("BAD_REQUEST", "暱稱請控制在 20 字以內");

  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    const player = entry.players.find((p) => p.id === playerId && p.status === "active");
    if (!player) throw new GameError("PLAYER_NOT_FOUND", "找不到你的角色，請重新入場");
    if (entry.session.certsIssued) {
      throw new GameError("BAD_REQUEST", "聘書已經發放，暱稱不能再改了");
    }
    if (player.nickname === nick) return { nickname: nick };

    const next: Player = { ...player, nickname: nick, updatedAt: new Date().toISOString() };
    await getDriver().savePlayers(code, [next]);
    Object.assign(player, next);
    return { nickname: nick };
  });
}

/**
 * 用暱稱認回自己的角色。
 *
 * 玩家換手機、清了瀏覽器資料、或分頁被系統回收之後，瀏覽器裡的身分就沒了，
 * 而角色已經被自己選走——沒有這個入口他整場就回不去了。
 *
 * 認證強度確實不高（同桌的人可能知道彼此的暱稱），但這是實體現場的派對遊戲，
 * 主持人就在旁邊，找回自己的角色比防範同桌冒名重要。
 * 錯誤訊息刻意不透露正確暱稱，也不說「這個角色的暱稱是空的」以外的細節。
 */
export async function rejoinSession(
  code: string,
  characterId: string,
  nickname: string,
): Promise<Player> {
  const nick = normalizeNickname(nickname);
  if (!nick) throw new GameError("BAD_REQUEST", "請輸入你入場時填的暱稱");

  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    if (entry.session.archived) {
      throw new GameError("SESSION_NOT_FOUND", "本場次已封存");
    }
    if (entry.session.status === "closed") {
      throw new GameError("SESSION_CLOSED", "本場次已結束");
    }

    // 刻意不看 stage.allowJoin：掉線最需要回來的時機就是遊戲進行到一半，
    // 這裡擋的是「新玩家入場」，不是「原本的人回來」。
    const player = entry.players.find(
      (p) => p.status === "active" && p.characterId === characterId,
    );
    if (!player) {
      throw new GameError("PLAYER_NOT_FOUND", "這個角色還沒有人選，直接選它入場即可");
    }
    if (!player.nickname.trim()) {
      throw new GameError(
        "BAD_REQUEST",
        "這個角色沒有填過暱稱，沒辦法用暱稱認回，請找主持人協助",
      );
    }
    if (normalizeNickname(player.nickname) !== nick) {
      throw new GameError("UNAUTHORIZED", "暱稱不正確");
    }

    const log = makeLog({
      type: "note",
      playerId: player.id,
      playerName: player.name,
      reason: "以暱稱重新進入",
      operator: "系統",
      // 掉線重連是私事，不必昭告全場
      publicVisible: false,
    });
    await getDriver().appendLogs(code, [log]);
    pushLog(entry, log);

    return player;
  });
}

/** 暱稱比對用：去空白、統一大小寫，免得玩家自己打的大小寫對不上 */
function normalizeNickname(raw: string): string {
  return (raw ?? "").trim().replace(/\s+/g, "").toLocaleLowerCase();
}

export async function removePlayer(code: string, playerId: string): Promise<void> {
  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    const player = entry.players.find((p) => p.id === playerId);
    if (!player) throw new GameError("PLAYER_NOT_FOUND", "找不到該玩家");

    const next: Player = { ...player, status: "removed", updatedAt: new Date().toISOString() };
    const log = makeLog({
      type: "note",
      playerId: player.id,
      playerName: player.name,
      reason: "已被移出場次",
      operator: "主持人",
      publicVisible: true,
    });

    await getDriver().savePlayers(code, [next]);
    await getDriver().appendLogs(code, [log]);

    Object.assign(player, next);
    pushLog(entry, log);
  });
}

/** 設定真實陣營。只有主持人能做，紀錄不對玩家公開。 */
/**
 * 把劇本指定的陣營套用到全場。
 *
 * 陣營是後來才固定下來的，改版前入場的玩家欄位是空的。這個動作只補「還沒設定」
 * 的人，已經被主持人手動改過的一律不動——陸秉白改投其他陣營就是這種情況。
 */
export async function applyScriptFactions(code: string): Promise<{ applied: number }> {
  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    const targets = entry.players.filter(
      (p) => p.status === "active" && !p.faction && scriptFaction(p.characterId),
    );
    if (targets.length === 0) return { applied: 0 };

    const now = new Date().toISOString();
    const logs: LogEntry[] = [];
    const next = targets.map((player) => {
      const faction = scriptFaction(player.characterId);
      logs.push(
        makeLog({
          type: "faction",
          playerId: player.id,
          playerName: player.name,
          reason: `依劇本套用陣營：${faction}`,
          operator: "主持人",
          // 陣營對玩家保密，紀錄也不能公開
          publicVisible: false,
        }),
      );
      return { ...player, faction, updatedAt: now };
    });

    await getDriver().savePlayers(code, next);
    await getDriver().appendLogs(code, logs);

    next.forEach((n) => {
      const cur = entry.players.find((p) => p.id === n.id);
      if (cur) Object.assign(cur, n);
    });
    pushLog(entry, ...logs);
    return { applied: next.length };
  });
}

export async function setFaction(
  code: string,
  playerId: string,
  faction: Faction | "",
): Promise<void> {
  if (faction !== "" && !FACTIONS.includes(faction)) {
    throw new GameError("BAD_REQUEST", "未知的陣營");
  }

  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    const player = entry.players.find((p) => p.id === playerId);
    if (!player) throw new GameError("PLAYER_NOT_FOUND", "找不到該玩家");

    const next: Player = { ...player, faction, updatedAt: new Date().toISOString() };
    const log = makeLog({
      type: "faction",
      playerId: player.id,
      playerName: player.name,
      reason: faction ? `設定陣營：${faction}` : "清除陣營",
      operator: "主持人",
      // 陣營是對玩家保密的資訊，連自己都不該從紀錄中看到
      publicVisible: false,
    });

    await getDriver().savePlayers(code, [next]);
    await getDriver().appendLogs(code, [log]);

    Object.assign(player, next);
    pushLog(entry, log);
  });
}

/**
 * 設定陸秉白的隱藏分支。依規則「設定後鎖定不可逆」，
 * 所以這裡刻意不提供修改，第二次呼叫會被擋下來。
 */
export async function setHiddenBranch(
  code: string,
  playerId: string,
  branch: HiddenBranch,
): Promise<void> {
  if (!HIDDEN_BRANCHES.includes(branch)) {
    throw new GameError("BAD_REQUEST", "未知的隱藏分支");
  }

  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    const player = entry.players.find((p) => p.id === playerId);
    if (!player) throw new GameError("PLAYER_NOT_FOUND", "找不到該玩家");

    const character = CHARACTER_MAP[player.characterId];
    if (!character?.hasHiddenBranch) {
      throw new GameError("BAD_REQUEST", `${player.name} 沒有隱藏分支機制`);
    }
    if (player.hiddenBranchLocked) {
      throw new GameError(
        "BAD_REQUEST",
        `隱藏分支已鎖定為「${player.hiddenBranch}」，依規則不可更改`,
      );
    }

    const next: Player = {
      ...player,
      hiddenBranch: branch,
      hiddenBranchLocked: true,
      updatedAt: new Date().toISOString(),
    };
    const log = makeLog({
      type: "branch",
      playerId: player.id,
      playerName: player.name,
      reason: `隱藏分支鎖定為「${branch}」`,
      operator: "主持人",
      publicVisible: false,
    });

    await getDriver().savePlayers(code, [next]);
    await getDriver().appendLogs(code, [log]);

    Object.assign(player, next);
    pushLog(entry, log);
  });
}

// ---------------- 資源發放 ----------------

export interface GrantInput {
  /** 傳 "ALL" 代表全體在場玩家 */
  playerIds: string[] | "ALL";
  resource: ResourceKey;
  delta: number;
  source?: LedgerSource;
  reason?: string;
  operator?: string;
}

export async function applyGrant(
  code: string,
  input: GrantInput,
): Promise<{ affected: number }> {
  const def = RESOURCE_MAP[input.resource];
  if (!def) throw new GameError("BAD_REQUEST", "未知的資源類型");
  if (!Number.isFinite(input.delta) || input.delta === 0) {
    throw new GameError("BAD_REQUEST", "變動值必須是不為零的數字");
  }

  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    if (entry.session.status === "closed") {
      throw new GameError("SESSION_CLOSED", "場次已結束，無法再調配資源");
    }

    const active = entry.players.filter((p) => p.status === "active");
    const targets =
      input.playerIds === "ALL"
        ? active
        : active.filter((p) => (input.playerIds as string[]).includes(p.id));

    if (targets.length === 0) throw new GameError("PLAYER_NOT_FOUND", "沒有選到任何玩家");

    const now = new Date().toISOString();
    const source = input.source ?? DEFAULT_LEDGER_SOURCE;
    const reason = input.reason?.trim() || source;
    const operator = input.operator?.trim() || "主持人";

    // 先算出新狀態（不動快取），確認寫入成功後才套用
    const updated: Player[] = targets.map((p) => {
      const next: Player = { ...p, updatedAt: now };
      next[input.resource] = p[input.resource] + input.delta;
      return next;
    });

    const logs = updated.map((p) =>
      makeLog({
        type: "grant",
        playerId: p.id,
        playerName: p.name,
        resource: def.label,
        delta: input.delta,
        balanceAfter: p[input.resource],
        source,
        reason,
        operator,
        // 數值變動一律只給本人。威望值雖然在榜單上是公開的，但「誰被扣了」
        // 會洩漏舉報與技能卡的結果，那些依規則不該公布明細
        publicVisible: false,
      }),
    );

    // 餘額與紀錄各一次批次請求，寫在不同分頁所以能並行
    const driver = getDriver();
    await Promise.all([driver.savePlayers(code, updated), driver.appendLogs(code, logs)]);

    targets.forEach((p, i) => Object.assign(p, updated[i]));
    pushLog(entry, ...logs);
    return { affected: targets.length };
  });
}

// ---------------- 舉報與調查 ----------------

export interface SubmitReportResult {
  report: Report;
}

/**
 * 玩家提出舉報。系統依線索卡對應表自動判定，主持人不需介入。
 *
 * 判定結果在結算前不會回傳給玩家——依規則要等開啟下一階段才公布。
 */
export async function submitReport(
  code: string,
  reporterId: string,
  targetId: string,
  clueCodeRaw: string,
): Promise<SubmitReportResult> {
  const clueCode = normalizeClueCode(clueCodeRaw);
  if (!clueCode) throw new GameError("BAD_REQUEST", "請填寫線索卡編號");

  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    const stage = STAGE_MAP[entry.session.stageId];
    if (!stage?.hasReport) {
      throw new GameError("BAD_REQUEST", `目前為「${stage?.label}」階段，尚未開放舉報`);
    }

    const reporter = entry.players.find((p) => p.id === reporterId && p.status === "active");
    const target = entry.players.find((p) => p.id === targetId && p.status === "active");
    if (!reporter) throw new GameError("PLAYER_NOT_FOUND", "找不到你的角色，請重新入場");
    if (!target) throw new GameError("PLAYER_NOT_FOUND", "找不到被舉報的對象");
    if (reporterId === targetId) throw new GameError("BAD_REQUEST", "不能舉報自己");

    /*
     * 判定規則（注意「指向別人」與「不在名單中」是兩種不同的待遇）：
     *
     *   21 張之一，且指向被舉報人 → 舉報成立，結算時扣被舉報人 1 威望
     *   21 張之一，但指向別人     → 「您輸入錯誤」，不受理也不留紀錄
     *   不在 21 張之中            → 受理，結算時扣舉報人 1 威望
     *
     * 也就是說拿著真卡指錯人只算填錯，可以重來；隨便編一個編號才要付代價。
     */
    const ownerCharacterId = clueOwner(clueCode);
    let verdict: ReportVerdict;

    if (ownerCharacterId) {
      if (ownerCharacterId !== target.characterId) {
        throw new GameError("BAD_CLUE", "您輸入錯誤");
      }
      // 單次使用只對真的線索卡有意義。編造的編號不做這個檢查——
      // 否則第二個人輸入同一串會被告知「已被使用」，等於洩漏有人送過。
      if (!clueAvailable(entry, clueCode)) {
        throw new GameError("BAD_CLUE", "此線索卡已被使用");
      }
      verdict = "success";
    } else {
      verdict = "fail";
    }

    const now = new Date().toISOString();

    const report: Report = {
      id: `R${nanoId()}`,
      ts: now,
      reporterId: reporter.id,
      reporterName: reporter.name,
      targetId: target.id,
      targetName: target.name,
      clueCode,
      verdict,
      judgedAt: now,
      settled: false,
      settledAt: "",
    };

    // 雙方都會在自己的動態看到「有舉報／被舉報」這件事，但看不到結果。
    // 兩筆都不公開，其他玩家不會知道場上發生過這件事。
    const logs = [
      makeLog({
        type: "report",
        playerId: reporter.id,
        playerName: reporter.name,
        reason: `提出舉報（線索 ${clueCode}），結果將於下一階段公布`,
        operator: "玩家",
        publicVisible: false,
      }),
      makeLog({
        type: "report",
        playerId: target.id,
        playerName: target.name,
        reason: "遭到舉報，結果將於下一階段公布",
        operator: "系統",
        publicVisible: false,
      }),
    ];

    await getDriver().createReport(code, report);
    await getDriver().appendLogs(code, logs);

    entry.reports.push(report);
    pushLog(entry, ...logs);
    return { report };
  });
}

/** 主持人判定舉報成立與否。威望值不會立刻變動，要等下次開啟招募才結算。 */
export async function judgeReport(
  code: string,
  reportId: string,
  verdict: Exclude<ReportVerdict, "">,
): Promise<Report> {
  if (verdict !== "success" && verdict !== "fail") {
    throw new GameError("BAD_REQUEST", "判定結果只能是成立或不成立");
  }

  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    const report = entry.reports.find((r) => r.id === reportId);
    if (!report) throw new GameError("BAD_REQUEST", "找不到這筆舉報");
    if (report.settled) throw new GameError("BAD_REQUEST", "這筆舉報已經結算，不能再改判定");

    const next: Report = { ...report, verdict, judgedAt: new Date().toISOString() };
    const log = makeLog({
      type: "report",
      playerId: report.targetId,
      playerName: report.targetName,
      reason:
        verdict === "success"
          ? `舉報成立：${report.reporterName} → ${report.targetName}（線索 ${report.clueCode}），待下次開啟招募時生效`
          : `舉報不成立：${report.reporterName} 誤舉報 ${report.targetName}，待下次開啟招募時生效`,
      operator: "主持人",
      publicVisible: false,
    });

    await getDriver().saveReports(code, [next]);
    await getDriver().appendLogs(code, [log]);

    Object.assign(report, next);
    pushLog(entry, log);
    return next;
  });
}

// ---------------- 玩家間勢力調配 ----------------

/**
 * 玩家把自己手上的勢力值轉給另一位玩家。遊戲進行中隨時可用。
 *
 * 第一週之後玩家看不到彼此的勢力值，所以送出方只知道自己扣了多少，
 * 這是刻意的——轉贈本身就是盲的。
 */
export async function transferPower(
  code: string,
  fromId: string,
  toId: string,
  amount: number,
): Promise<{ balance: number }> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new GameError("BAD_REQUEST", "轉贈的勢力值必須是大於零的整數");
  }
  if (fromId === toId) throw new GameError("BAD_REQUEST", "不能轉給自己");

  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    if (entry.session.status !== "open") {
      throw new GameError("SESSION_CLOSED", "場次目前不開放操作");
    }

    const from = entry.players.find((p) => p.id === fromId && p.status === "active");
    const to = entry.players.find((p) => p.id === toId && p.status === "active");
    if (!from) throw new GameError("PLAYER_NOT_FOUND", "找不到你的角色，請重新入場");
    if (!to) throw new GameError("PLAYER_NOT_FOUND", "找不到對象");
    if (from.power < amount) {
      throw new GameError("BAD_REQUEST", `勢力值不足，你目前只有 ${from.power}`);
    }

    const now = new Date().toISOString();
    const nextFrom: Player = { ...from, power: from.power - amount, updatedAt: now };
    const nextTo: Player = { ...to, power: to.power + amount, updatedAt: now };

    // 勢力值是機密，兩筆紀錄都只有當事人看得到
    const logs = [
      makeLog({
        type: "grant",
        playerId: from.id,
        playerName: from.name,
        resource: "勢力值",
        delta: -amount,
        balanceAfter: nextFrom.power,
        source: "玩家間轉贈",
        reason: `轉贈給 ${to.name}`,
        operator: from.name,
        publicVisible: false,
      }),
      makeLog({
        type: "grant",
        playerId: to.id,
        playerName: to.name,
        resource: "勢力值",
        delta: amount,
        balanceAfter: nextTo.power,
        source: "玩家間轉贈",
        reason: `來自 ${from.name} 的轉贈`,
        operator: from.name,
        publicVisible: false,
      }),
    ];

    const driver = getDriver();
    await Promise.all([
      driver.savePlayers(code, [nextFrom, nextTo]),
      driver.appendLogs(code, logs),
    ]);

    Object.assign(from, nextFrom);
    Object.assign(to, nextTo);
    pushLog(entry, ...logs);
    return { balance: nextFrom.power };
  });
}

// ---------------- 第一週投票 ----------------

/**
 * 一個人總共要投幾張。
 *
 * 通常是 3 張（同意 2 + 不同意 1），但三張票必須投給三個不同的人，
 * 所以人不夠時就投不滿——場上 3 個人時每人只能投 2 張。
 * 沒有這個上限，「全部投完才能進第二週」的閘門在小場次會永遠卡住。
 */
function voteQuota(activeCount: number): { approve: number; oppose: number; total: number } {
  const targets = Math.max(0, activeCount - 1);
  const approve = Math.min(VOTE_APPROVE_COUNT, targets);
  const oppose = Math.min(VOTE_OPPOSE_COUNT, Math.max(0, targets - approve));
  return { approve, oppose, total: approve + oppose };
}

/** 每個人還剩幾張票沒投。主持人看得到這個，但看不到投給誰。 */
export function voteProgress(entry: CacheEntry): VoteProgress[] {
  const active = entry.players.filter((p) => p.status === "active");
  const quota = voteQuota(active.length);

  return active.map((p) => {
    const mine = entry.votes.filter((v) => v.voterId === p.id);
    const approveUsed = mine.filter((v) => v.kind === "approve").length;
    const opposeUsed = mine.filter((v) => v.kind === "oppose").length;
    const approveLeft = Math.max(0, quota.approve - approveUsed);
    const opposeLeft = Math.max(0, quota.oppose - opposeUsed);
    return {
      playerId: p.id,
      playerName: p.name,
      approveLeft,
      opposeLeft,
      totalLeft: approveLeft + opposeLeft,
    };
  });
}

/** 全場都投完了嗎。沒投完不讓進下一階段。 */
export function allVotesCast(entry: CacheEntry): boolean {
  return voteProgress(entry).every((p) => p.totalLeft === 0);
}

/** 玩家投一張票 */
export async function castVote(
  code: string,
  voterId: string,
  targetId: string,
  kind: VoteKind,
): Promise<{ approveLeft: number; opposeLeft: number }> {
  if (kind !== "approve" && kind !== "oppose") {
    throw new GameError("BAD_REQUEST", "未知的票種");
  }

  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    const stage = STAGE_MAP[entry.session.stageId];
    if (!stage?.hasVote) {
      throw new GameError("BAD_REQUEST", `「${stage?.label ?? "本階段"}」沒有投票`);
    }

    const active = entry.players.filter((p) => p.status === "active");
    const voter = active.find((p) => p.id === voterId);
    if (!voter) throw new GameError("PLAYER_NOT_FOUND", "找不到你的角色，請重新入場");

    const target = active.find((p) => p.id === targetId);
    if (!target) throw new GameError("PLAYER_NOT_FOUND", "找不到這位玩家");
    if (target.id === voter.id) throw new GameError("BAD_REQUEST", "不能投給自己");

    const mine = entry.votes.filter((v) => v.voterId === voter.id);
    // 三張票要投給三個不同的人，所以只要投過就不能再投——不分票種
    if (mine.some((v) => v.targetId === target.id)) {
      throw new GameError("BAD_REQUEST", `你已經投過「${target.name}」了`);
    }

    const quota = voteQuota(active.length);
    const used = mine.filter((v) => v.kind === kind).length;
    const limit = kind === "approve" ? quota.approve : quota.oppose;
    if (used >= limit) {
      throw new GameError(
        "BAD_REQUEST",
        kind === "approve" ? "你的同意票已經用完了" : "你的不同意票已經用完了",
      );
    }

    const now = new Date().toISOString();
    const vote: Vote = {
      id: `V${nanoId()}`,
      ts: now,
      voterId: voter.id,
      voterName: voter.name,
      targetId: target.id,
      targetName: target.name,
      kind,
    };

    const log = makeLog({
      type: "vote",
      playerId: voter.id,
      playerName: voter.name,
      reason: `投給 ${target.name}：${kind === "approve" ? "同意" : "不同意"}`,
      operator: "系統",
      // 票型只有主持人在紀錄裡看得到，其他玩家一概不知
      publicVisible: false,
    });

    await getDriver().createVote(code, vote);
    await getDriver().appendLogs(code, [log]);

    entry.votes.push(vote);
    pushLog(entry, log);

    const approveUsed = mine.filter((v) => v.kind === "approve").length + (kind === "approve" ? 1 : 0);
    const opposeUsed = mine.filter((v) => v.kind === "oppose").length + (kind === "oppose" ? 1 : 0);
    return {
      approveLeft: Math.max(0, quota.approve - approveUsed),
      opposeLeft: Math.max(0, quota.oppose - opposeUsed),
    };
  });
}

/**
 * 投票結算。離開第一週時執行，只能在鎖內呼叫。
 *
 * 一張票 1 點威望，同意加、不同意減；結算後威望最高的人當選會長助理，
 * 額外拿 200 勢力。平票比勢力，勢力也一樣就比入場順序。
 */
function settleVotes(entry: CacheEntry): LogEntry[] {
  if (entry.votes.length === 0) return [];

  const active = entry.players.filter((p) => p.status === "active");
  const now = new Date().toISOString();
  const logs: LogEntry[] = [];

  for (const player of active) {
    const got = entry.votes.filter((v) => v.targetId === player.id);
    const approve = got.filter((v) => v.kind === "approve").length;
    const oppose = got.filter((v) => v.kind === "oppose").length;
    const delta = (approve - oppose) * VOTE_PRESTIGE;
    if (delta === 0) continue;

    player.prestige += delta;
    player.updatedAt = now;
    logs.push(
      makeLog({
        type: "vote",
        playerId: player.id,
        playerName: player.name,
        resource: "威望值",
        delta,
        balanceAfter: player.prestige,
        source: "投票獎勵",
        reason: `票選結果：同意 ${approve}、不同意 ${oppose}`,
        operator: "系統",
        // 別人的威望變動一律不公開，玩家只看得到自己那一筆
        publicVisible: false,
      }),
    );
  }

  // 會長助理：威望最高 → 勢力最高 → 入場最早
  const winner = [...active].sort(
    (a, b) =>
      b.prestige - a.prestige ||
      b.power - a.power ||
      a.joinedAt.localeCompare(b.joinedAt),
  )[0];

  if (winner) {
    winner.power += ASSISTANT_POWER;
    winner.updatedAt = now;
    logs.push(
      makeLog({
        type: "vote",
        playerId: winner.id,
        playerName: winner.name,
        resource: "勢力值",
        delta: ASSISTANT_POWER,
        balanceAfter: winner.power,
        source: "投票獎勵",
        reason: ASSISTANT_TITLE,
        operator: "系統",
        publicVisible: false,
      }),
    );
  }

  return logs;
}

// ---------------- 拍賣結算 ----------------

export interface AuctionResult {
  lotLabel: string;
  paid: number;
  value: number;
  /** 賺賠：真實價值減去出價 */
  net: number;
  balance: number;
}

/**
 * 拍賣結算。
 *
 * 現場喊價，主持人事後輸入得標者付了多少錢；系統先扣掉出價，再入帳標的的
 * 真實價值，差額就是這一標賺還是賠。兩筆分開記帳，玩家才看得懂錢的來去。
 *
 * 出價超過餘額會擋下來並報出目前餘額——那多半是打錯字，讓勢力值變負數
 * 之後很難查。
 */
export async function settleAuction(
  code: string,
  input: { playerId: string; lotId: string; paid: number; value?: number },
): Promise<AuctionResult> {
  const lot = AUCTION_LOT_MAP[input.lotId];
  if (!lot) throw new GameError("BAD_REQUEST", "沒有這個拍賣標的");

  const paid = Number(input.paid);
  if (!Number.isFinite(paid) || !Number.isInteger(paid) || paid < 0) {
    throw new GameError("BAD_REQUEST", "出價請填 0 以上的整數");
  }

  // 價值固定的標的用設定值；南洋花滿樓要主持人現場輸入
  let value: number;
  if (lot.value === null) {
    const raw = Number(input.value);
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
      throw new GameError("BAD_REQUEST", `「${lot.label}」的價值不固定，請一併輸入`);
    }
    value = raw;
  } else {
    value = lot.value;
  }

  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    const player = entry.players.find((p) => p.id === input.playerId && p.status === "active");
    if (!player) throw new GameError("PLAYER_NOT_FOUND", "找不到該玩家");

    if (paid > player.power) {
      throw new GameError(
        "BAD_REQUEST",
        `${player.name} 目前只有 ${player.power} 勢力值，付不出 ${paid}`,
      );
    }

    const now = new Date().toISOString();
    const afterPaid = player.power - paid;
    const balance = afterPaid + value;

    const logs: LogEntry[] = [
      makeLog({
        type: "grant",
        playerId: player.id,
        playerName: player.name,
        resource: "勢力值",
        delta: -paid,
        balanceAfter: afterPaid,
        source: "拍賣扣款",
        reason: `拍得「${lot.label}」`,
        operator: "主持人",
        // 勢力值只有本人看得到
        publicVisible: false,
      }),
      makeLog({
        type: "grant",
        playerId: player.id,
        playerName: player.name,
        resource: "勢力值",
        delta: value,
        balanceAfter: balance,
        source: "拍賣結算",
        reason: `「${lot.label}」的真實價值`,
        operator: "主持人",
        publicVisible: false,
      }),
    ];

    const next: Player = { ...player, power: balance, updatedAt: now };
    await Promise.all([
      getDriver().savePlayers(code, [next]),
      getDriver().appendLogs(code, logs),
    ]);

    Object.assign(player, next);
    pushLog(entry, ...logs);
    return { lotLabel: lot.label, paid, value, net: value - paid, balance };
  });
}

// ---------------- 招募抽取與技能卡 ----------------

export interface DrawItem {
  kind: "power" | "skill";
  /** 抽到勢力值時的點數 */
  amount?: number;
  /** 抽到技能卡時的資訊 */
  card?: { id: string; name: string; description: string };
}

export interface DrawResult {
  items: DrawItem[];
  /** 這一批抽到的勢力值總和 */
  powerGained: number;
  drawsRemaining: number;
  poolLeft: number;
}

/** 玩家抽招募，一次可抽多張 */
export async function drawRecruit(
  code: string,
  playerId: string,
  times = 1,
): Promise<DrawResult> {
  if (!Number.isInteger(times) || times < 1 || times > 10) {
    throw new GameError("BAD_REQUEST", "一次只能抽 1 到 10 張");
  }
  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    const stage = STAGE_MAP[entry.session.stageId];
    if (!stage?.autoRecruit) {
      throw new GameError("BAD_REQUEST", `「${stage?.label ?? "本階段"}」沒有招募`);
    }

    const player = entry.players.find((p) => p.id === playerId && p.status === "active");
    if (!player) throw new GameError("PLAYER_NOT_FOUND", "找不到你的角色，請重新入場");
    if (player.drawsRemaining <= 0) {
      throw new GameError("BAD_REQUEST", "你已經沒有招募機會了");
    }
    if (entry.session.pool.length === 0) {
      throw new GameError("BAD_REQUEST", "本階段的招募彩池已經抽完");
    }

    // 抽到沒次數或彩池見底就停，不足的部分不算錯誤
    const rounds = Math.min(times, player.drawsRemaining, entry.session.pool.length);
    const items: DrawItem[] = [];
    const logs: LogEntry[] = [];
    let powerGained = 0;

    for (let i = 0; i < rounds; i++) {
      // 先讀出這次會抽到什麼，applyDraw 會把它從彩池取走
      const parsed = parseToken(entry.session.pool[0]);
      logs.push(...applyDraw(entry, player));
      if (parsed?.kind === "power") {
        powerGained += parsed.amount;
        items.push({ kind: "power", amount: parsed.amount });
      } else if (parsed?.kind === "skill") {
        items.push({
          kind: "skill",
          card: {
            id: parsed.card.id,
            name: parsed.card.name,
            description: parsed.card.description,
          },
        });
      }
    }

    // 玩家餘額與紀錄即時寫入；彩池合併延後，省下三分之一的寫入次數
    await Promise.all([
      getDriver().savePlayers(code, [player]),
      getDriver().appendLogs(code, logs),
    ]);
    scheduleSessionSave(code);
    pushLog(entry, ...logs);

    return {
      items,
      powerGained,
      drawsRemaining: player.drawsRemaining,
      poolLeft: entry.session.pool.length,
    };
  });
}

/**
 * 發放會長就任聘書。依最終勢力值排名決定職位與稱號。
 *
 * 依規則，第 1 名與第 2 名同分時不可自動判定會長，必須由主持人先處理，
 * 所以這裡會擋下來而不是自行選一個。
 */
export async function issueCertificates(code: string): Promise<{ issued: number }> {
  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    const active = entry.players.filter((p) => p.status === "active");
    if (active.length === 0) throw new GameError("PLAYER_NOT_FOUND", "場上沒有玩家");

    const missing = active.filter((p) => !p.nickname.trim());
    if (missing.length > 0) {
      throw new GameError(
        "BAD_REQUEST",
        `${missing.map((p) => p.name).join("、")} 沒有填暱稱，聘書無法署名`,
      );
    }

    const ordered = [...active].sort(
      (a, b) => b.power - a.power || a.joinedAt.localeCompare(b.joinedAt),
    );
    if (ordered.length >= 2 && ordered[0].power === ordered[1].power) {
      throw new GameError(
        "BAD_REQUEST",
        `${ordered[0].name} 與 ${ordered[1].name} 勢力值同為 ${ordered[0].power}，` +
          "無法自動判定會長，請先調整後再發放",
      );
    }

    const now = new Date().toISOString();
    const logs: LogEntry[] = ordered.map((player, i) => {
      const rank = i + 1;
      player.certRank = rank;
      player.updatedAt = now;
      return makeLog({
        type: "cert",
        playerId: player.id,
        playerName: player.name,
        reason: `第 ${rank} 名・${positionForRank(rank)}・${titleForRank(rank)}`,
        operator: "主持人",
        publicVisible: true,
      });
    });

    entry.session.certsIssued = true;
    entry.session.updatedAt = now;

    cancelScheduledSessionSave(code);
    await getDriver().saveSession(entry.session);
    await getDriver().savePlayers(code, ordered);
    await getDriver().appendLogs(code, logs);
    pushLog(entry, ...logs);

    return { issued: ordered.length };
  });
}

/** 使用手上的技能卡，必須指定一位目標玩家 */
export async function useSkillCard(
  code: string,
  playerId: string,
  cardId: string,
  targetId: string,
): Promise<{ heldCards: string[] }> {
  const card = SKILL_CARDS[cardId];
  if (!card) throw new GameError("BAD_REQUEST", "未知的技能卡");

  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    const player = entry.players.find((p) => p.id === playerId && p.status === "active");
    const target = entry.players.find((p) => p.id === targetId && p.status === "active");
    if (!player) throw new GameError("PLAYER_NOT_FOUND", "找不到你的角色，請重新入場");
    if (!target) throw new GameError("PLAYER_NOT_FOUND", "找不到目標玩家");
    if (playerId === targetId) throw new GameError("BAD_REQUEST", "不能對自己使用");

    const held = player.heldCards.indexOf(cardId);
    if (held < 0) throw new GameError("BAD_REQUEST", "你手上沒有這張技能卡");

    const now = new Date().toISOString();
    const logs: LogEntry[] = [];

    /** 產生一筆數值變動紀錄。只給本人，別人從動態看不出誰被構陷了。 */
    const change = (p: Player, resource: "power" | "prestige", delta: number) => {
      p[resource] += delta;
      p.updatedAt = now;
      const isPrestige = resource === "prestige";
      logs.push(
        makeLog({
          type: "skill",
          playerId: p.id,
          playerName: p.name,
          resource: isPrestige ? "威望值" : "勢力值",
          delta,
          balanceAfter: p[resource],
          source: "技能卡效果",
          reason: `技能卡「${card.name}」`,
          operator: player.name,
          publicVisible: false,
        }),
      );
    };

    switch (card.kind) {
      case "stealPrestige":
        // 只扣目標，使用者不增加
        change(target, "prestige", -card.amount);
        break;
      case "stealPower": {
        // 對方不足時只偷得到現有的部分，不會讓對方變成負數
        const taken = Math.min(card.amount, Math.max(0, target.power));
        change(target, "power", -taken);
        change(player, "power", taken);
        break;
      }
      case "giftPrestige":
        change(player, "prestige", card.amount);
        change(target, "prestige", card.amount);
        break;
      case "giftPower":
        change(player, "power", card.amount);
        change(target, "power", card.amount);
        break;
    }

    player.heldCards.splice(held, 1);
    player.updatedAt = now;

    await Promise.all([
      getDriver().savePlayers(code, [player, target]),
      getDriver().appendLogs(code, logs),
    ]);
    pushLog(entry, ...logs);
    return { heldCards: [...player.heldCards] };
  });
}

/**
 * 重新發放本階段的招募次數並重建彩池。
 *
 * 用於補救：改版前建立的場次停在某個階段時，沒有經過「切換階段」這個動作，
 * 因此從來沒拿到抽取次數，玩家會看到招募但無法抽。
 */
export async function resetRecruit(code: string): Promise<{ draws: number; poolLeft: number }> {
  return withLock(code, async () => {
    const entry = await getEntryLocked(code);
    const stage = STAGE_MAP[entry.session.stageId];
    if (!stage?.grantsDraws) {
      throw new GameError("BAD_REQUEST", `「${stage?.label ?? "本階段"}」不發放招募次數`);
    }

    entry.session.poolStage = entry.session.stageId;
    entry.session.pool = buildPool(entry.session.stageId);
    entry.session.updatedAt = new Date().toISOString();

    const logs = grantDraws(entry, `${stage.label}（重新發放）`);

    cancelScheduledSessionSave(code);
    await getDriver().saveSession(entry.session);
    await getDriver().savePlayers(
      code,
      entry.players.filter((p) => p.status === "active"),
    );
    await getDriver().appendLogs(code, logs);
    pushLog(entry, ...logs);

    return {
      draws: entry.players.reduce((sum, p) => sum + p.drawsRemaining, 0),
      poolLeft: entry.session.pool.length,
    };
  });
}
