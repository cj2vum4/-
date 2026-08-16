"use client";

import { useEffect, useMemo, useState } from "react";
import { LogFeed } from "@/components/log-feed";
import { ResourceStat } from "@/components/resource-stat";
import {
  BackLink,
  Button,
  CodeStamp,
  Field,
  Notice,
  PageShell,
  Panel,
  PanelTitle,
  StatusPill,
} from "@/components/ui";
import { RESOURCES, STAGE_MAP } from "@/lib/config";
import {
  ApiError,
  api,
  clearPlayerIdentity,
  loadPlayerIdentity,
  savePlayerIdentity,
  type PlayerIdentity,
} from "@/lib/client";
import { rankPlayers, useSessionState } from "@/lib/use-session-state";
import type { Player } from "@/lib/types";

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

  if (me === null) {
    return <JoinForm code={code} onJoined={setMe} />;
  }

  return <LiveBoard code={code} me={me} onReset={() => setMe(null)} />;
}

function JoinForm({
  code,
  onJoined,
}: {
  code: string;
  onJoined: (p: PlayerIdentity) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ session: { title: string } }>(`/api/sessions/${code}`)
      .then((d) => alive && setSessionTitle(d.session.title))
      .catch((err) => {
        if (alive && err instanceof ApiError && err.code === "SESSION_NOT_FOUND") {
          setMissing(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [code]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ player: Player }>(`/api/sessions/${code}/join`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      const identity: PlayerIdentity = {
        id: data.player.id,
        name: data.player.name,
        joinCode: data.player.joinCode,
      };
      savePlayerIdentity(code, identity);
      onJoined(identity);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "入場失敗");
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

      <header className="mt-6 mb-6">
        <p className="text-xs tracking-[0.3em] text-muted">即將入府</p>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 text-2xl font-bold text-paper">
          {sessionTitle ?? code}
          <CodeStamp code={code} />
        </h1>
        <p className="mt-2 text-sm text-muted">請留下你在九爺府中的稱號。</p>
      </header>

      <Panel>
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="你的稱號"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：六姨太"
            maxLength={20}
            autoComplete="off"
            autoFocus
          />
          {error ? <Notice>{error}</Notice> : null}
          <Button type="submit" disabled={busy || !name.trim()} className="w-full">
            {busy ? "入場中…" : "入 府"}
          </Button>
        </form>
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
  const { snapshot, error, loading } = useSessionState(code, { intervalMs: 3000 });

  const ranked = useMemo(() => rankPlayers(snapshot?.players ?? []), [snapshot]);
  const myIndex = ranked.findIndex((p) => p.id === me.id);
  const mine = myIndex >= 0 ? ranked[myIndex] : null;
  const session = snapshot?.session;
  const stage = session ? STAGE_MAP[session.stageId] : undefined;

  const myLog = useMemo(
    () => (snapshot?.log ?? []).filter((e) => e.playerId === me.id || e.playerId === ""),
    [snapshot, me.id],
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

  // 主持人把玩家移出，或換了裝置／清了資料
  if (snapshot && !mine) {
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
        </div>
        <h1 className="mt-3 text-2xl font-bold text-paper">{mine?.name}</h1>
        <p className="mt-1 text-sm text-gold-soft">
          目前階段：{stage?.label ?? session?.stageId}
          {stage?.hint ? <span className="text-muted/70">　{stage.hint}</span> : null}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        {RESOURCES.map((r) => (
          <ResourceStat key={r.key} def={r} value={mine?.[r.key] ?? 0} size="lg" />
        ))}
      </div>

      <p className="mt-3 text-center text-sm text-muted">
        目前排名　
        <b className="tabular text-xl text-paper">{myIndex + 1}</b>
        <span className="text-muted/60"> / {ranked.length}</span>
      </p>

      <div className="mt-5 space-y-4">
        <Panel>
          <PanelTitle>群 芳 榜</PanelTitle>
          <ul className="space-y-1.5">
            {ranked.map((p, i) => {
              const isMe = p.id === me.id;
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
                  <span className="shrink-0 text-xs text-muted/50">威</span>
                  <span className="tabular shrink-0 text-sm text-jade-soft">{p.influence}</span>
                  <span className="shrink-0 text-xs text-muted/50">勢</span>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel>
          <PanelTitle>我 的 動 態</PanelTitle>
          <div className="max-h-80 overflow-y-auto">
            <LogFeed log={myLog} empty="還沒有你的紀錄，靜候九爺差遣" />
          </div>
        </Panel>
      </div>

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => {
            if (!confirm("要離開這個身分、重新入場嗎？原本的資料仍保留在紀錄中。")) return;
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
