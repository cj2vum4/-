"use client";

import { useEffect, useMemo, useState } from "react";
import { Certificate } from "@/components/certificate";
import { CharacterPoster } from "@/components/character-poster";
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
import { DRAW_BATCHES, RESOURCE_MAP, STAGE_MAP } from "@/lib/config";
import { SKILL_CARDS } from "@/lib/recruit";
import {
  ApiError,
  api,
  clearPlayerIdentity,
  loadPlayerIdentity,
  savePlayerIdentity,
  type PlayerIdentity,
} from "@/lib/client";
import { usePlayerState } from "@/lib/use-session-state";
import type { MyReportView, PublicPlayerView, RevealedClue, SelfPlayerView } from "@/lib/types";

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
  poster: string | null;
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
  const [nickname, setNickname] = useState("");
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

  const pickedChar = characters?.find((c) => c.id === picked) ?? null;
  /** 選到已經有人的角色＝掉線回來認自己的角色，用暱稱比對 */
  const rejoining = Boolean(pickedChar?.taken);

  async function join() {
    if (!picked) return;
    if (!nickname.trim()) {
      setError(rejoining ? "請輸入你入場時填的暱稱" : "請先輸入你的暱稱");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const path = rejoining ? "rejoin" : "join";
      const data = await api<{ player: PlayerIdentity }>(`/api/sessions/${code}/${path}`, {
        method: "POST",
        body: JSON.stringify({ characterId: picked, nickname: nickname.trim() }),
      });
      savePlayerIdentity(code, data.player);
      onJoined(data.player);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : rejoining ? "認回失敗" : "入場失敗");
      // 認回失敗多半是暱稱打錯，角色留著讓他再試一次；新入場才需要重選
      if (!rejoining) setPicked(null);
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
        <div className="mb-3 rounded-xl border border-gold/40 bg-gold/8 p-3">
          <label className="block">
            <span className="mb-1.5 block text-xs tracking-widest text-gold/85">
              {rejoining ? "你入場時填的暱稱" : "你的暱稱（會印在最後的聘書上）"}
            </span>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={rejoining ? "要跟當初填的一樣" : "例：海星"}
              maxLength={20}
              className="w-full rounded-lg border border-line bg-lacquer px-3 py-2.5 text-base text-paper outline-none placeholder:text-muted/45 focus:border-gold/70"
            />
          </label>
        </div>

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
                    disabled={busy}
                    onClick={() => {
                      setPicked(c.id);
                      setError(null);
                    }}
                    className={`w-full rounded-xl border px-3.5 py-3 text-left transition-colors ${
                      on
                        ? "border-gold bg-gold/12"
                        : c.taken
                          ? "border-line/50 bg-panel-2/30 opacity-50"
                          : "border-line bg-panel-2/60"
                    }`}
                  >
                    <div className="flex gap-3">
                      <CharacterPoster
                        src={c.poster}
                        alt={c.name}
                        className="h-20 w-16 shrink-0 rounded border border-line object-cover"
                      />
                      <div className="min-w-0 flex-1">
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
                        {on ? (
                          <span className="text-gold">✓</span>
                        ) : c.taken ? (
                          <span className="text-muted/60">已選走・點我認回</span>
                        ) : null}
                      </span>
                    </div>
                    <p className={`mt-1 text-xs ${on ? "text-gold-soft/90" : "text-paper/70"}`}>
                      {c.personality}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted/65">
                      {c.appearance}
                    </p>
                      </div>
                    </div>
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
        {rejoining ? (
          <p className="mb-2 text-[11px] leading-relaxed text-muted/75">
            「{pickedChar?.name}」已經有人了。如果那是你——換手機、清了瀏覽器、
            或分頁被關掉——輸入你入場時填的暱稱就能回到遊戲，數值都還在。
          </p>
        ) : null}
        <Button onClick={join} disabled={!picked || !nickname.trim() || busy} className="w-full">
          {busy
            ? rejoining
              ? "認回中…"
              : "入場中…"
            : !nickname.trim()
              ? rejoining
                ? "請輸入你當初填的暱稱"
                : "請先輸入暱稱"
              : pickedChar
                ? rejoining
                  ? `以暱稱認回「${pickedChar.name}」`
                  : `以「${pickedChar.name}」入府`
                : "請選擇角色"}
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
  const { snapshot, error, loading, refresh } = usePlayerState(code, me);
  const [tab, setTab] = useState("me");

  const session = snapshot?.session;
  const stage = session ? STAGE_MAP[session.stageId] : undefined;
  const mine = snapshot?.me;
  const character = mine ? CHARACTER_MAP[mine.characterId] : undefined;

  const prestigeBoard = useMemo(
    () => [...(snapshot?.players ?? [])].sort((a, b) => (b.prestige ?? 0) - (a.prestige ?? 0)),
    [snapshot],
  );
  const powerBoard = useMemo(
    () =>
      [...(snapshot?.players ?? [])].sort(
        (a, b) => (a.powerRank ?? 99) - (b.powerRank ?? 99) || (b.power ?? 0) - (a.power ?? 0),
      ),
    [snapshot],
  );
  const peerPower = snapshot?.session.peerPower ?? "hidden";
  const showPrestige = snapshot?.session.showPrestige ?? false;

  // 舉報分頁只在開放的階段出現，避免佔用導覽列位置
  const tabs: TabDef[] = [
    { id: "me", label: "我的", glyph: "印" },
    { id: "board", label: "榜單", glyph: "榜" },
    { id: "act", label: "行動", glyph: "令" },
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
          {/* 聘書發放後就置頂——這是整場遊戲的最後成果，值得第一眼看到 */}
          {mine.certificate ? <Certificate cert={mine.certificate} /> : null}

          <div
            className={`grid gap-2.5 ${
              showHp && showPrestige ? "grid-cols-3" : showPrestige || showHp ? "grid-cols-2" : "grid-cols-1"
            }`}
          >
            <ResourceStat def={RESOURCE_MAP.power} value={mine.power} size="lg" />
            {showPrestige ? (
              <ResourceStat def={RESOURCE_MAP.prestige} value={mine.prestige ?? 0} size="lg" />
            ) : null}
            {showHp ? <ResourceStat def={RESOURCE_MAP.hp} value={mine.hp} size="lg" /> : null}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {mine.powerRank ? (
              <StatBox label="勢力排名" value={`${mine.powerRank}`} suffix={`/ ${powerBoard.length}`} />
            ) : null}
            <StatBox label="招募機會" value={`${mine.drawsRemaining}`} suffix="次" />
          </div>

          <Panel className="p-3.5">
            <SectionTitle>場 次 資 訊</SectionTitle>
            <dl className="space-y-1.5 text-sm">
              <Row label="場次" value={<CodeStamp code={code} />} />
              <NicknameField
                code={code}
                me={me}
                current={mine.nickname}
                locked={Boolean(session?.certsIssued)}
                onSaved={refresh}
              />
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
              {session?.recruitOpen ? (
                <Row label="招募機會" value={`${mine.drawsRemaining} 次`} />
              ) : null}
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
          {peerPower === "value" ? (
            <Panel className="p-3.5">
              <SectionTitle>勢 力 榜</SectionTitle>
              <ul className="space-y-1">
                {powerBoard.map((p) => (
                  <BoardRow
                    key={p.id}
                    rank={p.powerRank ?? 0}
                    name={p.name}
                    isMe={p.id === mine.id}
                    value={`${p.power ?? 0}`}
                    tone="jade"
                  />
                ))}
              </ul>
            </Panel>
          ) : (
            <Panel className="p-3.5">
              <SectionTitle>我 的 勢 力</SectionTitle>
              <p className="tabular py-2 text-center text-4xl font-bold text-jade-soft">
                {mine.power}
              </p>
              <p className="mt-1 text-center text-[11px] leading-relaxed text-muted/70">
                本階段起，勢力值只有自己看得到，也不再公布名次。
              </p>
            </Panel>
          )}

          {showPrestige ? (
            <Panel className="p-3.5">
              <SectionTitle>威 望 榜</SectionTitle>
              <ul className="space-y-1">
                {prestigeBoard.map((p, i) => (
                  <BoardRow
                    key={p.id}
                    rank={i + 1}
                    name={p.name}
                    isMe={p.id === mine.id}
                    value={`${p.prestige ?? 0}`}
                    tone="gold"
                  />
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      ) : null}

      {tab === "act" ? (
        <PlayerActions
          code={code}
          me={me}
          mine={mine}
          players={(snapshot?.players ?? []).filter((p) => p.id !== mine.id)}
          myReports={snapshot?.myReports ?? []}
          revealedClues={snapshot?.revealedClues ?? []}
          reportOpen={Boolean(stage?.hasReport)}
          recruitOpen={Boolean(session?.recruitOpen)}
          stageLabel={stage?.label ?? ""}
        />
      ) : null}

      {tab === "role" && character ? (
        <div className="space-y-3">
          {character.poster ? (
            <Panel className="overflow-hidden p-0">
              <CharacterPoster
                src={character.poster}
                alt={character.name}
                className="w-full object-contain"
              />
            </Panel>
          ) : null}

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

/**
 * 暱稱是聘書上的署名。
 *
 * 這個欄位是後來才加的，改版前入場的玩家一定是空的——沒有補填的入口他們就永遠
 * 拿不到聘書。聘書發放後鎖住，證書上的名字不該還會變。
 */
function NicknameField({
  code,
  me,
  current,
  locked,
  onSaved,
}: {
  code: string;
  me: PlayerIdentity;
  current: string;
  locked: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await api(`/api/sessions/${code}/nickname`, {
        method: "POST",
        player: me,
        body: JSON.stringify({ nickname: value.trim() }),
      });
      setEditing(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "暱稱儲存失敗");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={20}
            placeholder="聘書上的署名"
            className="min-w-0 flex-1 rounded border border-line bg-panel-2 px-2 py-1 text-sm text-paper outline-none focus:border-gold"
          />
          <Button size="sm" disabled={busy || !value.trim()} onClick={save}>
            存
          </Button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            className="shrink-0 text-[11px] text-muted underline underline-offset-4"
          >
            取消
          </button>
        </div>
        {error ? <p className="text-[11px] text-vermilion-soft">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-xs text-muted">暱稱</dt>
      <dd className="flex min-w-0 items-center justify-end gap-2">
        <span className={`truncate ${current ? "text-paper/85" : "text-vermilion-soft"}`}>
          {current || "尚未填寫"}
        </span>
        {locked ? null : (
          <button
            type="button"
            onClick={() => {
              setValue(current);
              setEditing(true);
            }}
            className="shrink-0 text-[11px] text-muted underline underline-offset-4"
          >
            {current ? "修改" : "填寫"}
          </button>
        )}
      </dd>
    </div>
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
 * 玩家的主動操作：招募抽取、技能卡、勢力調配、舉報。
 *
 * 舉報的判定結果刻意不當場回饋——依規則要等開啟下一階段才公布。
 */
interface DrawResponse {
  items: { kind: "power" | "skill"; amount?: number; card?: { name: string; description: string } }[];
  powerGained: number;
  drawsRemaining: number;
  poolLeft: number;
}

/** 一次抽多張時，把整批結果講成一句話：先報勢力值總和，再列抽到的技能卡 */
function summariseDraw(d: DrawResponse): string {
  const parts: string[] = [];
  if (d.powerGained > 0) parts.push(`勢力值 +${d.powerGained}`);
  const cards = d.items.filter((i) => i.kind === "skill").map((i) => `「${i.card?.name}」`);
  if (cards.length > 0) parts.push(`技能卡 ${cards.join("、")}`);
  const gained = parts.length > 0 ? parts.join("，") : "沒有抽到東西";
  return `抽了 ${d.items.length} 張：${gained}。剩餘 ${d.drawsRemaining} 次。`;
}

function PlayerActions({
  code,
  me,
  mine,
  players,
  myReports,
  revealedClues,
  reportOpen,
  recruitOpen,
  stageLabel,
}: {
  code: string;
  me: PlayerIdentity;
  mine: SelfPlayerView;
  players: PublicPlayerView[];
  myReports: MyReportView[];
  revealedClues: RevealedClue[];
  reportOpen: boolean;
  recruitOpen: boolean;
  stageLabel: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const [cardTargets, setCardTargets] = useState<Record<number, string>>({});
  const [giftTarget, setGiftTarget] = useState("");
  const [giftAmount, setGiftAmount] = useState("");
  const [target, setTarget] = useState("");
  const [clue, setClue] = useState("");

  function reset() {
    setError(null);
    setResult(null);
  }

  async function draw(times: number) {
    reset();
    setBusy(true);
    try {
      const d = await api<DrawResponse>(`/api/sessions/${code}/recruit/draw`, {
        method: "POST",
        player: me,
        body: JSON.stringify({ times }),
      });
      setResult(summariseDraw(d));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "招募失敗");
    } finally {
      setBusy(false);
    }
  }

  async function useCard(index: number, cardId: string) {
    reset();
    const targetId = cardTargets[index];
    if (!targetId) return setError("請先選擇技能卡的目標");
    const card = SKILL_CARDS[cardId];
    const name = players.find((p) => p.id === targetId)?.name ?? "對方";
    if (!confirm(`對「${name}」使用技能卡「${card?.name}」？\n${card?.description}`)) return;

    setBusy(true);
    try {
      await api(`/api/sessions/${code}/recruit/use-card`, {
        method: "POST",
        player: me,
        body: JSON.stringify({ cardId, targetId }),
      });
      setResult(`已對 ${name} 使用「${card?.name}」。`);
      setCardTargets((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "使用技能卡失敗");
    } finally {
      setBusy(false);
    }
  }

  async function transfer() {
    reset();
    if (!giftTarget) return setError("請選擇要轉贈的對象");
    const amount = Number(giftAmount);
    if (!Number.isInteger(amount) || amount <= 0) return setError("請輸入大於零的整數");
    if (amount > mine.power) return setError(`勢力值不足，你目前只有 ${mine.power}`);

    const name = players.find((p) => p.id === giftTarget)?.name ?? "對方";
    if (!confirm(`確定將 ${amount} 點勢力值轉給「${name}」？轉出後無法收回。`)) return;

    setBusy(true);
    try {
      const data = await api<{ balance: number }>(`/api/sessions/${code}/transfer`, {
        method: "POST",
        player: me,
        body: JSON.stringify({ targetId: giftTarget, amount }),
      });
      setResult(`已轉贈 ${amount} 點給 ${name}，你剩餘 ${data.balance} 點。`);
      setGiftAmount("");
      setGiftTarget("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "轉贈失敗");
    } finally {
      setBusy(false);
    }
  }

  async function report() {
    reset();
    if (!target) return setError("請選擇要舉報的對象");
    if (!clue.trim()) return setError("請填寫線索卡編號");

    setBusy(true);
    try {
      await api(`/api/sessions/${code}/reports`, {
        method: "POST",
        player: me,
        body: JSON.stringify({ targetId: target, clueCode: clue.trim() }),
      });
      setResult("舉報已送出。結果會在開啟下一階段時公布。");
      setTarget("");
      setClue("");
    } catch (err) {
      // 線索卡不存在或已被使用時，後端會給明確訊息
      setError(err instanceof ApiError ? err.message : "舉報失敗");
    } finally {
      setBusy(false);
    }
  }

  const targetSelect = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-line bg-lacquer px-3 py-2.5 text-sm text-paper outline-none focus:border-gold/70"
    >
      <option value="">{placeholder}</option>
      {players.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-3">
      {error ? <Notice>{error}</Notice> : null}
      {result ? <Notice kind="success">{result}</Notice> : null}

      {/* ---- 勢力招募：永遠顯示，沒得抽時說明原因，才不會讓人以為功能不見了 ---- */}
      <Panel className="p-3.5">
        <SectionTitle
          extra={
            recruitOpen ? (
              <span className="text-[11px] text-muted">剩 {mine.drawsRemaining} 次</span>
            ) : null
          }
        >
          勢 力 招 募
        </SectionTitle>
        {!recruitOpen ? (
          <p className="py-1 text-center text-xs leading-relaxed text-muted/70">
            「{stageLabel}」階段沒有招募。
            <br />
            招募從第一週開始，第二週、第三週、第六幕會各發一次機會。
          </p>
        ) : (
          <>
            {mine.drawsRemaining > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {DRAW_BATCHES.map((n) => (
                  <Button
                    key={n}
                    variant="jade"
                    disabled={busy || mine.drawsRemaining < n}
                    onClick={() => draw(n)}
                  >
                    抽 {n} 次
                  </Button>
                ))}
              </div>
            ) : (
              <Button variant="jade" className="w-full" disabled>
                招募機會已用完
              </Button>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-muted/70">
              {mine.drawsRemaining > 0
                ? "可能抽到勢力值，也可能抽到技能卡。未用完的次數會在主持人切換到下一階段時自動抽完。"
                : "下一個階段開始時會再發放新的機會。"}
            </p>
          </>
        )}
      </Panel>

      {/* ---- 手上的技能卡：永遠顯示，沒有卡時也說明 ---- */}
      <Panel className="p-3.5">
        <SectionTitle
          extra={
            mine.heldCards.length > 0 ? (
              <span className="text-[11px] text-muted">{mine.heldCards.length} 張</span>
            ) : null
          }
        >
          技 能 卡
        </SectionTitle>
        {mine.heldCards.length === 0 ? (
          <p className="py-1 text-center text-xs leading-relaxed text-muted/70">
            目前沒有技能卡。招募時有機會抽到，抽到後會出現在這裡，選好目標即可使用。
          </p>
        ) : (
          <ul className="space-y-2.5">
            {mine.heldCards.map((cardId, i) => {
              const card = SKILL_CARDS[cardId];
              if (!card) return null;
              return (
                <li key={`${cardId}-${i}`} className="rounded-lg border border-gold/40 bg-gold/8 p-3">
                  <p className="text-sm font-bold text-gold-soft">{card.name}</p>
                  <p className="mt-0.5 text-xs text-paper/80">{card.description}</p>
                  <div className="mt-2 space-y-2">
                    {targetSelect(
                      cardTargets[i] ?? "",
                      (v) => setCardTargets((prev) => ({ ...prev, [i]: v })),
                      "選擇目標…",
                    )}
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={busy}
                      onClick={() => useCard(i, cardId)}
                    >
                      使用
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {/* ---- 勢力調配：任何階段都能用 ---- */}
      <Panel className="p-3.5">
        <SectionTitle extra={<span className="text-[11px] text-muted">持有 {mine.power}</span>}>
          勢 力 調 配
        </SectionTitle>
        <div className="space-y-2.5">
          {targetSelect(giftTarget, setGiftTarget, "選擇轉贈對象…")}
          <div className="flex gap-2">
            <input
              value={giftAmount}
              onChange={(e) => setGiftAmount(e.target.value)}
              placeholder="轉贈點數"
              inputMode="numeric"
              className="tabular min-w-0 flex-1 rounded-lg border border-line bg-lacquer px-3 py-2.5 text-sm text-paper outline-none placeholder:text-muted/45 focus:border-gold/70"
            />
            <Button
              variant="jade"
              onClick={transfer}
              disabled={busy || mine.power <= 0}
              className="shrink-0 px-5"
            >
              轉贈
            </Button>
          </div>
        </div>
      </Panel>

      {/* ---- 舉報 ---- */}
      {reportOpen ? (
        <>
          <Panel className="p-3.5">
            <SectionTitle>我 要 舉 報</SectionTitle>
            <div className="space-y-2.5">
              {targetSelect(target, setTarget, "選擇舉報對象…")}
              <input
                value={clue}
                onChange={(e) => setClue(e.target.value)}
                placeholder="線索卡編號"
                autoCapitalize="characters"
                className="w-full rounded-lg border border-line bg-lacquer px-3 py-2.5 text-sm tracking-widest text-paper uppercase outline-none placeholder:text-muted/45 placeholder:normal-case focus:border-gold/70"
              />
              <Button onClick={report} disabled={busy} className="w-full">
                {busy ? "送出中…" : "送出舉報"}
              </Button>
              <p className="text-[11px] leading-relaxed text-muted/70">
                線索卡若對應到被舉報者，對方威望 −1；對應到其他人，則自己威望 −1。
                每張線索卡只能用一次；舉報失敗的會在結算後釋放，可再次使用。
              </p>
            </div>
          </Panel>

          {myReports.length > 0 ? (
            <Panel className="p-3.5">
              <SectionTitle>我 送 出 的 舉 報</SectionTitle>
              <ul className="space-y-1.5">
                {myReports.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 text-xs">
                    <b className="text-paper/85">{r.targetName}</b>
                    <span className="text-muted/60">線索 {r.clueCode}</span>
                    <span className="ml-auto shrink-0">
                      {!r.settled ? (
                        <span className="text-muted">待下一階段公布</span>
                      ) : r.verdict === "success" ? (
                        <span className="text-jade-soft">成立</span>
                      ) : (
                        <span className="text-vermilion-soft">不成立</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </>
      ) : (
        <Panel className="p-3.5">
          <p className="py-2 text-center text-xs leading-relaxed text-muted/70">
            「{stageLabel}」階段尚未開放舉報。
          </p>
        </Panel>
      )}

      {/* ---- 已公開的線索卡：舉報成立後全場都看得到 ---- */}
      {revealedClues.length > 0 ? (
        <Panel className="p-3.5">
          <SectionTitle>已 公 開 的 線 索</SectionTitle>
          <ul className="space-y-1">
            {revealedClues.map((c) => (
              <li
                key={c.code}
                className="flex items-center gap-2 rounded border border-vermilion/30 bg-vermilion/5 px-2.5 py-1.5 text-xs"
              >
                <b className="tabular tracking-widest text-vermilion-soft">{c.code}</b>
                <span className="text-muted">指向</span>
                <b className="text-paper/85">{c.ownerName}</b>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
