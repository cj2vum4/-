"use client";

import { useEffect, useMemo, useState } from "react";
import { LogFeed } from "@/components/log-feed";
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
import { RESOURCE_MAP, STAGE_MAP } from "@/lib/config";
import {
  ApiError,
  api,
  clearPlayerIdentity,
  loadPlayerIdentity,
  savePlayerIdentity,
  type PlayerIdentity,
} from "@/lib/client";
import { usePlayerState } from "@/lib/use-session-state";

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
    <PageShell>
      <BackLink href="/player" label="換一個場次" />

      <header className="mt-6 mb-5">
        <p className="text-xs tracking-[0.3em] text-muted">即將入府</p>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 text-2xl font-bold text-paper">
          {sessionTitle ?? code}
          <CodeStamp code={code} />
        </h1>
        <p className="mt-2 text-sm text-muted">
          請選擇你要扮演的角色。角色皆可反串，不受性別限制。
        </p>
      </header>

      <Panel>
        <PanelTitle>選 擇 角 色</PanelTitle>
        {characters === null ? (
          <p className="py-6 text-center text-sm text-muted">載入角色中…</p>
        ) : (
          <ul className="space-y-2.5">
            {characters.map((c) => {
              const on = picked === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={c.taken || busy}
                    onClick={() => setPicked(c.id)}
                    className={`w-full rounded-xl border px-4 py-3.5 text-left transition-colors ${
                      c.taken
                        ? "cursor-not-allowed border-line/50 bg-panel-2/30 opacity-40"
                        : on
                          ? "border-gold bg-gold/12"
                          : "border-line bg-panel-2/60 hover:border-gold/50"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-lg font-bold ${on ? "text-gold-soft" : "text-paper"}`}
                      >
                        {c.name}
                      </span>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[11px] ${DIFFICULTY_STYLE[c.difficulty]}`}
                      >
                        難度 {c.difficulty}
                      </span>
                      <span className="text-xs text-muted">
                        {c.gender}・{c.age} 歲・{c.occupation}
                      </span>
                      {c.note ? (
                        <span className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted">
                          {c.note}
                        </span>
                      ) : null}
                      <span className="ml-auto shrink-0 text-xs">
                        {c.taken ? (
                          <span className="text-muted/60">已被選走</span>
                        ) : on ? (
                          <span className="text-gold">✓ 已選擇</span>
                        ) : null}
                      </span>
                    </div>

                    <p
                      className={`mt-1.5 text-sm ${on ? "text-gold-soft/90" : "text-paper/75"}`}
                    >
                      {c.personality}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted/70">
                      {c.appearance}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {error ? (
          <div className="mt-4">
            <Notice>{error}</Notice>
          </div>
        ) : null}

        <Button onClick={join} disabled={!picked || busy} className="mt-4 w-full">
          {busy ? "入場中…" : "入 府"}
        </Button>
      </Panel>
    </PageShell>
  );
}

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

  const session = snapshot?.session;
  const stage = session ? STAGE_MAP[session.stageId] : undefined;
  const mine = snapshot?.me;

  /** 威望值公開，可以直接排；勢力值只拿得到名次 */
  const prestigeBoard = useMemo(
    () => [...(snapshot?.players ?? [])].sort((a, b) => b.prestige - a.prestige),
    [snapshot],
  );
  const powerBoard = useMemo(
    () => [...(snapshot?.players ?? [])].sort((a, b) => a.powerRank - b.powerRank),
    [snapshot],
  );

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
  const character = CHARACTER_MAP[mine.characterId];
  const showHp = stage?.id === "gunfight" || mine.hp > 0;

  return (
    <PageShell>
      <div className="flex items-center justify-between gap-3">
        <BackLink href="/" label="回身分選擇" />
        <span className="text-xs text-muted/60">每 3 秒自動更新</span>
      </div>

      <header className="mt-4 mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <CodeStamp code={code} />
          {session ? <StatusPill status={session.status} /> : null}
          {session?.recruitOpen ? (
            <span className="rounded-full border border-jade/50 bg-jade/10 px-2.5 py-0.5 text-xs text-jade-soft">
              招募開放中
            </span>
          ) : null}
        </div>
        <h1 className="mt-3 flex flex-wrap items-center gap-2 text-2xl font-bold text-paper">
          {mine.name}
          {character ? (
            <span
              className={`rounded border px-1.5 py-0.5 text-[11px] font-normal ${DIFFICULTY_STYLE[character.difficulty]}`}
            >
              難度 {character.difficulty}
            </span>
          ) : null}
        </h1>
        {character ? (
          <p className="mt-1 text-xs text-muted">
            {character.gender}・{character.age} 歲・{character.occupation}
            {character.note ? `・${character.note}` : ""}
          </p>
        ) : null}
        <p className="mt-1 text-sm text-gold-soft">
          {stage ? `第 ${stage.index} 階段・${stage.label}` : session?.stageId}
          {stage?.hint ? <span className="text-muted/70">　{stage.hint}</span> : null}
        </p>
      </header>

      <div className={`grid gap-3 ${showHp ? "grid-cols-3" : "grid-cols-2"}`}>
        <ResourceStat def={RESOURCE_MAP.power} value={mine.power} size="lg" />
        <ResourceStat def={RESOURCE_MAP.prestige} value={mine.prestige} size="lg" />
        {showHp ? <ResourceStat def={RESOURCE_MAP.hp} value={mine.hp} size="lg" /> : null}
      </div>

      <p className="mt-3 text-center text-sm text-muted">
        勢力排名　
        <b className="tabular text-xl text-paper">{mine.powerRank}</b>
        <span className="text-muted/60"> / {powerBoard.length}</span>
        {mine.drawsRemaining > 0 ? (
          <span className="ml-3 text-jade-soft">剩餘抽取 {mine.drawsRemaining} 次</span>
        ) : null}
      </p>

      <div className="mt-5 space-y-4">
        <Panel>
          <PanelTitle extra={<span className="text-xs text-muted/70">只顯示名次</span>}>
            勢 力 榜
          </PanelTitle>
          <ul className="space-y-1.5">
            {powerBoard.map((p) => {
              const isMe = p.id === mine.id;
              return (
                <li
                  key={p.id}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                    isMe ? "border-jade/60 bg-jade/10" : "border-transparent bg-panel-2/50"
                  }`}
                >
                  <span
                    className={`tabular w-5 shrink-0 text-sm ${p.powerRank <= 3 ? "text-jade-soft" : "text-muted"}`}
                  >
                    {p.powerRank}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${isMe ? "font-bold text-paper" : "text-paper/80"}`}
                  >
                    {p.name}
                    {isMe ? <span className="ml-1.5 text-xs text-jade">（你）</span> : null}
                  </span>
                  <span className="tabular shrink-0 text-sm">
                    {isMe ? (
                      <span className="text-jade-soft">{mine.power}</span>
                    ) : (
                      <span className="text-muted/40">???</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-muted/60">
            勢力值只有本人看得到數字，其他人僅能看到名次。
          </p>
        </Panel>

        <Panel>
          <PanelTitle>威 望 榜</PanelTitle>
          <ul className="space-y-1.5">
            {prestigeBoard.map((p, i) => {
              const isMe = p.id === mine.id;
              return (
                <li
                  key={p.id}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                    isMe ? "border-gold/60 bg-gold/10" : "border-transparent bg-panel-2/50"
                  }`}
                >
                  <span
                    className={`tabular w-5 shrink-0 text-sm ${i < 3 ? "text-gold-soft" : "text-muted"}`}
                  >
                    {i + 1}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${isMe ? "font-bold text-paper" : "text-paper/80"}`}
                  >
                    {p.name}
                    {isMe ? <span className="ml-1.5 text-xs text-gold">（你）</span> : null}
                  </span>
                  <span className="tabular shrink-0 text-sm text-gold-soft">{p.prestige}</span>
                </li>
              );
            })}
          </ul>
        </Panel>

        {character ? (
          <Panel>
            <details>
              <summary className="cursor-pointer list-none text-sm font-bold tracking-[0.2em] text-gold/90 select-none">
                我 的 角 色　
                <span className="text-xs font-normal tracking-normal text-muted/60">
                  （點開查看設定）
                </span>
              </summary>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex gap-3">
                  <dt className="w-12 shrink-0 text-xs text-muted">性格</dt>
                  <dd className="text-paper/85">{character.personality}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="w-12 shrink-0 text-xs text-muted">外貌</dt>
                  <dd className="text-paper/85">{character.appearance}</dd>
                </div>
              </dl>
            </details>
          </Panel>
        ) : null}

        <Panel>
          <PanelTitle>我 的 動 態</PanelTitle>
          <div className="max-h-80 overflow-y-auto">
            <LogFeed log={snapshot?.log ?? []} empty="還沒有你的紀錄，靜候九爺差遣" />
          </div>
        </Panel>
      </div>

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => {
            if (!confirm("要離開這個身分、重新選角嗎？原本的資料仍保留在紀錄中。")) return;
            clearPlayerIdentity(code);
            onReset();
          }}
          className="text-xs text-muted/60 underline underline-offset-4 transition-colors hover:text-vermilion-soft"
        >
          切換身分
        </button>
      </div>
    </PageShell>
  );
}
