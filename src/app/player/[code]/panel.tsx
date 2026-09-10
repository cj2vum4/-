"use client";

import { useEffect, useMemo, useState } from "react";
import { LogFeed } from "@/components/log-feed";
import { AppShell, SectionTitle, ShellHeader, type TabDef } from "@/components/mobile-shell";
import { ResourceStat } from "@/components/resource-stat";
import {
  BackLink,
  Button,
  CodeStamp,
  Notice,
  PageShell,
  Panel,
  PanelTitle,
  StatusPill,
} from "@/components/ui";
import { CHARACTER_MAP, DIFFICULTY_STYLE, type Difficulty } from "@/lib/characters";
import { INVESTIGATION_LIMIT, RESOURCE_MAP, STAGE_MAP } from "@/lib/config";
import {
  ApiError,
  api,
  clearPlayerIdentity,
  loadPlayerIdentity,
  savePlayerIdentity,
  type PlayerIdentity,
} from "@/lib/client";
import { usePlayerState } from "@/lib/use-session-state";
import type { MyReportView, PublicPlayerView, SelfPlayerView } from "@/lib/types";

interface CharacterOption {
  id: string;
  name: string;
  difficulty: Difficulty;
  gender: string;
  age: number;
  occupation: string;
  personality: string;
  appearance: string;
  note: string | null;
  taken: boolean;
}

export function PlayerPanel({ code }: { code: string }) {
  /** undefined = 還在讀 localStorage */
  const [me, setMe] = useState<PlayerIdentity | null | undefined>(undefined);

  useEffect(() => {
    setMe(loadPlayerIdentity(code));
  }, [code]);

  if (me === undefined) {
    return (
      <PageShell>
        <p className="py-20 text-center text-sm text-muted">讀取中…</p>
      </PageShell>
    );
  }
  if (me === null) return <CharacterPicker code={code} onJoined={setMe} />;
  return <LiveBoard code={code} me={me} onReset={() => setMe(null)} />;
}

// ---------------- 選角 ----------------

function CharacterPicker({
  code,
  onJoined,
}: {
  code: string;
  onJoined: (p: PlayerIdentity) => void;
}) {
  const [characters, setCharacters] = useState<CharacterOption[] | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ session: { title: string }; characters: CharacterOption[] }>(
        `/api/sessions/${code}`,
      )
        .then((d) => {
          if (!alive) return;
          setSessionTitle(d.session.title);
          setCharacters(d.characters);
        })
        .catch((err) => {
          if (alive && err instanceof ApiError && err.code === "SESSION_NOT_FOUND") {
            setMissing(true);
          }
        });

    void load();
    // 有人選走角色時要即時反映，避免兩人搶同一位
    const timer = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [code]);

  async function join() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ player: PlayerIdentity }>(`/api/sessions/${code}/join`, {
        method: "POST",
        body: JSON.stringify({ characterId: picked }),
      });
      savePlayerIdentity(code, data.player);
      onJoined(data.player);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "入場失敗");
      setPicked(null);
    } finally {
      setBusy(false);
    }
  }

  if (missing) {
    return (
      <PageShell>
        <BackLink href="/player" label="重新輸入場次" />
        <div className="mt-8">
          <Notice>無此場次</Notice>
        </div>
      </PageShell>
    );
  }

  return (
    <div className="app-shell mx-auto w-full max-w-lg">
      <header className="shrink-0 border-b border-line/60 bg-lacquer/90 px-4 py-2.5">
        <ShellHeader
          backHref="/player"
          title={
            <>
              {sessionTitle ?? code}
              <CodeStamp code={code} />
            </>
          }
          subtitle="選擇角色。角色皆可反串，不受性別限制。"
        />
      </header>

      <div className="app-scroll px-4 py-3">
        {characters === null ? (
          <p className="py-6 text-center text-sm text-muted">載入角色中…</p>
        ) : (
          <ul className="space-y-2">
            {characters.map((c) => {
              const on = picked === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={c.taken || busy}
                    onClick={() => setPicked(c.id)}
                    className={`w-full rounded-xl border px-3.5 py-3 text-left transition-colors ${
                      c.taken
                        ? "cursor-not-allowed border-line/50 bg-panel-2/30 opacity-40"
                        : on
                          ? "border-gold bg-gold/12"
                          : "border-line bg-panel-2/60"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`text-base font-bold ${on ? "text-gold-soft" : "text-paper"}`}>
                        {c.name}
                      </span>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] ${DIFFICULTY_STYLE[c.difficulty]}`}
                      >
                        {c.difficulty}
                      </span>
                      <span className="text-xs text-muted">
                        {c.gender}・{c.age}・{c.occupation}
                      </span>
                      {c.note ? (
                        <span className="rounded border border-line px-1 text-[10px] text-muted">
                          {c.note}
                        </span>
                      ) : null}
                      <span className="ml-auto shrink-0 text-xs">
                        {c.taken ? (
                          <span className="text-muted/60">已選走</span>
                        ) : on ? (
                          <span className="text-gold">✓</span>
                        ) : null}
                      </span>
                    </div>
                    <p className={`mt-1 text-xs ${on ? "text-gold-soft/90" : "text-paper/70"}`}>
                      {c.personality}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted/65">
                      {c.appearance}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {error ? (
          <div className="mt-3">
            <Notice>{error}</Notice>
          </div>
        ) : null}
      </div>

      <div className="safe-bottom shrink-0 border-t border-line bg-lacquer/95 px-4 py-3">
        <Button onClick={join} disabled={!picked || busy} className="w-full">
          {busy ? "入場中…" : picked ? `以「${characters?.find((c) => c.id === picked)?.name}」入府` : "請先選擇角色"}
        </Button>
      </div>
    </div>
  );
}

// ---------------- 場上面板 ----------------

function LiveBoard({
  code,
  me,
  onReset,
}: {
  code: string;
  me: PlayerIdentity;
  onReset: () => void;
}) {
  const { snapshot, error, loading } = usePlayerState(code, me);
  const [tab, setTab] = useState("me");

  const session = snapshot?.session;
  const stage = session ? STAGE_MAP[session.stageId] : undefined;
  const mine = snapshot?.me;
  const character = mine ? CHARACTER_MAP[mine.characterId] : undefined;

  const prestigeBoard = useMemo(
    () => [...(snapshot?.players ?? [])].sort((a, b) => b.prestige - a.prestige),
    [snapshot],
  );
  const powerBoard = useMemo(
    () => [...(snapshot?.players ?? [])].sort((a, b) => a.powerRank - b.powerRank),
    [snapshot],
  );

  // 舉報分頁只在開放的階段出現，避免佔用導覽列位置
  const tabs: TabDef[] = [
    { id: "me", label: "我的", glyph: "印" },
    { id: "board", label: "榜單", glyph: "榜" },
    ...(stage?.hasReport ? [{ id: "act", label: "舉報", glyph: "劾" }] : []),
    { id: "role", label: "角色", glyph: "卷" },
    { id: "log", label: "動態", glyph: "誌" },
  ];

  // 階段改變導致舉報分頁消失時，把使用者帶回「我的」
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab("me");
  }, [tabs, tab]);

  if (loading && !snapshot) {
    return (
      <PageShell>
        <p className="py-20 text-center text-sm text-muted">載入中…</p>
      </PageShell>
    );
  }

  if (error?.code === "SESSION_NOT_FOUND") {
    return (
      <PageShell>
        <BackLink href="/player" label="重新輸入場次" />
        <div className="mt-8">
          <Notice>無此場次</Notice>
        </div>
      </PageShell>
    );
  }

  if (error?.code === "PLAYER_NOT_FOUND" || (snapshot && !mine)) {
    return (
      <PageShell>
        <BackLink href="/player" label="重新輸入場次" />
        <div className="mt-8 space-y-4">
          <Notice>你目前不在這個場次中，請重新入場。</Notice>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              clearPlayerIdentity(code);
              onReset();
            }}
          >
            重新入場
          </Button>
        </div>
      </PageShell>
    );
  }

  if (!mine) return null;
  const showHp = stage?.id === "gunfight" || mine.hp !== 0;

  return (
    <AppShell
      tabs={tabs}
      active={tab}
      onTabChange={setTab}
      header={
        <ShellHeader
          title={
            <>
              {mine.name}
              {character ? (
                <span
                  className={`rounded border px-1 text-[10px] font-normal ${DIFFICULTY_STYLE[character.difficulty]}`}
                >
                  {character.difficulty}
                </span>
              ) : null}
            </>
          }
          subtitle={
            <>
              第 {stage?.index} 階段・{stage?.label}
              {session?.recruitOpen ? (
                <span className="ml-1.5 text-jade-soft">・招募開放中</span>
              ) : null}
            </>
          }
          right={session ? <StatusPill status={session.status} /> : null}
        />
      }
    >
      {tab === "me" ? (
        <div className="space-y-3">
          <div className={`grid gap-2.5 ${showHp ? "grid-cols-3" : "grid-cols-2"}`}>
            <ResourceStat def={RESOURCE_MAP.power} value={mine.power} size="lg" />
            <ResourceStat def={RESOURCE_MAP.prestige} value={mine.prestige} size="lg" />
            {showHp ? <ResourceStat def={RESOURCE_MAP.hp} value={mine.hp} size="lg" /> : null}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <StatBox label="勢力排名" value={`${mine.powerRank}`} suffix={`/ ${powerBoard.length}`} />
            <StatBox label="剩餘抽取" value={`${mine.drawsRemaining}`} suffix="次" />
          </div>

          <Panel className="p-3.5">
            <SectionTitle>場 次 資 訊</SectionTitle>
            <dl className="space-y-1.5 text-sm">
              <Row label="場次" value={<CodeStamp code={code} />} />
              <Row label="階段" value={`${stage?.index}・${stage?.label}`} />
              <Row
                label="招募"
                value={
                  session?.recruitOpen ? (
                    <span className="text-jade-soft">開放中</span>
                  ) : (
                    <span className="text-muted">未開放</span>
                  )
                }
              />
              <Row label="調查剩餘" value={`${mine.investigationsLeft} / ${INVESTIGATION_LIMIT} 次`} />
            </dl>
          </Panel>

          <button
            type="button"
            onClick={() => {
              if (!confirm("要離開這個身分、重新選角嗎？原本的資料仍保留在紀錄中。")) return;
              clearPlayerIdentity(code);
              onReset();
            }}
            className="w-full py-1 text-center text-xs text-muted/60 underline underline-offset-4"
          >
            切換身分
          </button>
        </div>
      ) : null}

      {tab === "board" ? (
        <div className="space-y-3">
          <Panel className="p-3.5">
            <SectionTitle extra={<span className="text-[11px] text-muted/70">只顯示名次</span>}>
              勢 力 榜
            </SectionTitle>
            <ul className="space-y-1">
              {powerBoard.map((p) => (
                <BoardRow
                  key={p.id}
                  rank={p.powerRank}
                  name={p.name}
                  isMe={p.id === mine.id}
                  value={p.id === mine.id ? `${mine.power}` : "???"}
                  tone="jade"
                />
              ))}
            </ul>
            <p className="mt-2 text-[11px] leading-relaxed text-muted/60">
              勢力值只有本人看得到數字。
            </p>
          </Panel>

          <Panel className="p-3.5">
            <SectionTitle>威 望 榜</SectionTitle>
            <ul className="space-y-1">
              {prestigeBoard.map((p, i) => (
                <BoardRow
                  key={p.id}
                  rank={i + 1}
                  name={p.name}
                  isMe={p.id === mine.id}
                  value={`${p.prestige}`}
                  tone="gold"
                />
              ))}
            </ul>
          </Panel>
        </div>
      ) : null}

      {tab === "act" ? (
        <ReportActions
          code={code}
          me={me}
          mine={mine}
          players={(snapshot?.players ?? []).filter((p) => p.id !== mine.id)}
          myReports={snapshot?.myReports ?? []}
        />
      ) : null}

      {tab === "role" && character ? (
        <div className="space-y-3">
          <Panel className="p-3.5">
            <SectionTitle>基 本 設 定</SectionTitle>
            <dl className="space-y-1.5 text-sm">
              <Row label="姓名" value={character.name} />
              <Row label="性別" value={character.gender} />
              <Row label="年齡" value={`${character.age} 歲`} />
              <Row label="職業" value={character.occupation} />
              <Row label="難度" value={character.difficulty} />
              {character.note ? <Row label="備註" value={character.note} /> : null}
            </dl>
          </Panel>
          <Panel className="p-3.5">
            <SectionTitle>性 格</SectionTitle>
            <p className="text-sm leading-relaxed text-paper/85">{character.personality}</p>
          </Panel>
          <Panel className="p-3.5">
            <SectionTitle>外 貌</SectionTitle>
            <p className="text-sm leading-relaxed text-paper/85">{character.appearance}</p>
          </Panel>
        </div>
      ) : null}

      {tab === "log" ? (
        <Panel className="p-3.5">
          <SectionTitle>我 的 動 態</SectionTitle>
          <LogFeed log={snapshot?.log ?? []} empty="還沒有你的紀錄，靜候九爺差遣" />
        </Panel>
      ) : null}
    </AppShell>
  );
}

function StatBox({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2/50 px-3 py-2.5 text-center">
      <p className="text-[11px] tracking-[0.2em] text-muted">{label}</p>
      <p className="tabular mt-0.5 text-2xl font-bold text-paper">
        {value}
        {suffix ? <span className="ml-1 text-xs font-normal text-muted/60">{suffix}</span> : null}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-xs text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-paper/85">{value}</dd>
    </div>
  );
}

function BoardRow({
  rank,
  name,
  isMe,
  value,
  tone,
}: {
  rank: number;
  name: string;
  isMe: boolean;
  value: string;
  tone: "jade" | "gold";
}) {
  const accent = tone === "jade" ? "text-jade-soft" : "text-gold-soft";
  const border = tone === "jade" ? "border-jade/60 bg-jade/10" : "border-gold/60 bg-gold/10";
  return (
    <li
      className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 ${
        isMe ? border : "border-transparent bg-panel-2/50"
      }`}
    >
      <span className={`tabular w-4 shrink-0 text-xs ${rank <= 3 ? accent : "text-muted"}`}>
        {rank}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-sm ${isMe ? "font-bold text-paper" : "text-paper/80"}`}
      >
        {name}
        {isMe ? <span className={`ml-1 text-[10px] ${accent}`}>你</span> : null}
      </span>
      <span
        className={`tabular shrink-0 text-sm ${value === "???" ? "text-muted/40" : accent}`}
      >
        {value}
      </span>
    </li>
  );
}

/**
 * 舉報與調查。
 *
 * 刻意不顯示「有沒有人舉報我」——那要花一次調查機會才查得到，
 * 所以玩家端的快照裡也只有自己送出的舉報。
 */
function ReportActions({
  code,
  me,
  mine,
  players,
  myReports,
}: {
  code: string;
  me: PlayerIdentity;
  mine: SelfPlayerView;
  players: PublicPlayerView[];
  myReports: MyReportView[];
}) {
  const [target, setTarget] = useState("");
  const [clue, setClue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function submit() {
    if (!target) return setError("請選擇要舉報的對象");
    if (!clue.trim()) return setError("請填寫線索卡編號");
    setBusy(true);
    setError(null);
    try {
      await api(`/api/sessions/${code}/reports`, {
        method: "POST",
        player: me,
        body: JSON.stringify({ targetId: target, clueCode: clue.trim() }),
      });
      setResult("舉報已送出，等待主持人判定");
      setTarget("");
      setClue("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "舉報失敗");
    } finally {
      setBusy(false);
    }
  }

  async function investigate() {
    if (
      !confirm(
        `確定要使用一次調查機會嗎？剩餘 ${mine.investigationsLeft} 次（全場上限 ${INVESTIGATION_LIMIT} 次）。`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ reportedCount: number; investigationsLeft: number }>(
        `/api/sessions/${code}/investigate`,
        { method: "POST", player: me },
      );
      setResult(
        data.reportedCount > 0
          ? `調查結果：目前有 ${data.reportedCount} 筆針對你的舉報。剩餘 ${data.investigationsLeft} 次。`
          : `調查結果：目前沒有人舉報你。剩餘 ${data.investigationsLeft} 次。`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "調查失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Panel className="p-3.5">
        <SectionTitle extra={<span className="text-[11px] text-muted">剩 {mine.investigationsLeft} 次</span>}>
          調 查 線 索
        </SectionTitle>
        <Button
          variant="ghost"
          className="w-full"
          disabled={busy || mine.investigationsLeft <= 0}
          onClick={investigate}
        >
          {mine.investigationsLeft > 0 ? "查詢是否有人舉報我" : "調查次數已用完"}
        </Button>
      </Panel>

      <Panel className="p-3.5">
        <SectionTitle>我 要 舉 報</SectionTitle>
        <div className="space-y-2.5">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-full rounded-lg border border-line bg-lacquer px-3 py-2.5 text-sm text-paper outline-none focus:border-gold/70"
          >
            <option value="">選擇舉報對象…</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            value={clue}
            onChange={(e) => setClue(e.target.value)}
            placeholder="線索卡編號，例：C03"
            className="w-full rounded-lg border border-line bg-lacquer px-3 py-2.5 text-sm text-paper outline-none placeholder:text-muted/45 focus:border-gold/70"
          />
          <Button onClick={submit} disabled={busy} className="w-full">
            {busy ? "送出中…" : "送出舉報"}
          </Button>
          <p className="text-[11px] leading-relaxed text-muted/70">
            舉報成立則對方威望 −1；誤舉報則自己威望 −1。
            結果不會立刻生效，會在下一次開啟招募時結算。
          </p>
        </div>
      </Panel>

      {error ? <Notice>{error}</Notice> : null}
      {result ? <Notice kind="success">{result}</Notice> : null}

      {myReports.length > 0 ? (
        <Panel className="p-3.5">
          <SectionTitle>我 送 出 的 舉 報</SectionTitle>
          <ul className="space-y-1.5">
            {myReports.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-xs">
                <b className="text-paper/85">{r.targetName}</b>
                <span className="text-muted/60">線索 {r.clueCode}</span>
                <span className="ml-auto shrink-0">
                  {r.verdict === "" ? (
                    <span className="text-muted">待判定</span>
                  ) : r.verdict === "success" ? (
                    <span className="text-jade-soft">成立{r.settled ? "・已生效" : "・待生效"}</span>
                  ) : (
                    <span className="text-vermilion-soft">
                      不成立{r.settled ? "・已生效" : "・待生效"}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
