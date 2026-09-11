"use client";

import { useEffect, useState } from "react";
import { Certificate } from "@/components/certificate";
import { StoryView } from "@/components/story-view";
import { CHARACTER_MAP } from "@/lib/characters";
import { ApiError, api, type PlayerIdentity } from "@/lib/client";
import { formatTime } from "@/lib/date";
import { Button, CodeStamp, Notice, Panel, PanelTitle } from "@/components/ui";
import type { Certificate as CertificateData } from "@/lib/types";

/**
 * 場次結束後的個人回顧。
 *
 * 場次一封存，工作分頁就刪了，資料只剩試算表的彙整分頁——這個畫面是從那裡
 * 讀回來的唯讀版本，所以沒有任何操作，只有自己的成績、聘書與紀錄。
 */

interface ReviewData {
  session: { code: string; title: string; finalStage: string; endedAt: string };
  me: {
    id: string;
    name: string;
    nickname: string;
    power: number;
    prestige: number;
    hp: number;
    certificate: CertificateData | null;
  };
  log: Array<{
    ts: string;
    type: string;
    resource: string;
    delta: number | "";
    balanceAfter: number | "";
    reason: string;
  }>;
  certsIssued: boolean;
}

interface RosterEntry {
  id: string;
  name: string;
  nickname: string;
  certRank: number;
}

export function SessionReview({
  code,
  me,
}: {
  code: string;
  /** 瀏覽器裡還留著身分的話就直接開那個角色，沒有就讓他自己挑 */
  me: PlayerIdentity | null;
}) {
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [picked, setPicked] = useState<string | null>(me?.id ?? null);
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showStory, setShowStory] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ roster: RosterEntry[] }>(`/api/sessions/${code}/review`)
      .then((d) => alive && setRoster(d.roster))
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : "讀取場次紀錄失敗");
      });
    return () => {
      alive = false;
    };
  }, [code]);

  useEffect(() => {
    if (!picked) return;
    let alive = true;
    setData(null);
    api<ReviewData>(`/api/sessions/${code}/review?player=${encodeURIComponent(picked)}`)
      .then((d) => alive && setData(d))
      .catch((err) => {
        if (!alive) return;
        // 瀏覽器裡存的身分可能是別場的，挑不到就退回名單讓他自己選
        setPicked(null);
        setError(err instanceof ApiError ? err.message : "讀取紀錄失敗");
      });
    return () => {
      alive = false;
    };
  }, [code, picked]);

  const character = data ? CHARACTER_MAP[
    Object.keys(CHARACTER_MAP).find((id) => CHARACTER_MAP[id].name === data.me.name) ?? ""
  ] : undefined;

  if (showStory && data) {
    return (
      <StoryView
        code={code}
        me={me}
        myCharacterId={character?.id}
        onClose={() => setShowStory(false)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="safe-top shrink-0 border-b border-line bg-lacquer/95 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold text-paper">
              {data?.me.name ?? "場次回顧"}
            </h1>
            <p className="truncate text-[11px] text-muted/70">
              {data ? `${data.session.title}・已結束` : "已結束的場次"}
            </p>
          </div>
          {picked ? (
            <button
              type="button"
              onClick={() => {
                setPicked(null);
                setData(null);
                setError(null);
              }}
              className="shrink-0 rounded-full border border-line bg-panel-2 px-2.5 py-1 text-[11px] text-muted hover:text-gold"
            >
              換角色
            </button>
          ) : (
            <span className="shrink-0 rounded-full border border-line bg-panel-2 px-2 py-0.5 text-[11px] text-muted">
              回顧
            </span>
          )}
        </div>
      </header>

      <div className="app-scroll space-y-3 px-4 py-4">
        {error ? <Notice>{error}</Notice> : null}

        {!picked ? (
          roster === null ? (
            <p className="py-10 text-center text-sm text-muted">讀取名單中…</p>
          ) : (
            <>
              <p className="mb-1 text-sm leading-relaxed text-muted">
                這個場次已經結束。選擇你當時扮演的角色，就能看到自己的聘書與紀錄。
              </p>
              <ul className="space-y-2">
                {roster.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setPicked(r.id);
                      }}
                      className="w-full rounded-xl border border-line bg-panel-2/60 px-3.5 py-3 text-left transition-colors hover:border-gold/60"
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-base font-bold text-paper">{r.name}</span>
                        {r.nickname ? (
                          <span className="text-xs text-muted">{r.nickname}</span>
                        ) : null}
                        {r.certRank ? (
                          <span className="ml-auto shrink-0 text-[11px] text-gold-soft">
                            第 {r.certRank} 名
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )
        ) : null}

        {picked && !data && !error ? (
          <p className="py-10 text-center text-sm text-muted">讀取紀錄中…</p>
        ) : null}

        {data ? (
          <>
            {data.me.certificate ? <Certificate cert={data.me.certificate} /> : null}

            {data.certsIssued ? (
              <Button variant="jade" className="w-full" onClick={() => setShowStory(true)}>
                查看故事復盤
              </Button>
            ) : null}

            <div className="grid grid-cols-2 gap-2.5">
              <Stat label="最終勢力值" value={data.me.power} accent="text-jade-soft" />
              <Stat label="最終威望值" value={data.me.prestige} accent="text-gold-soft" />
            </div>

            <Panel className="p-3.5">
              <PanelTitle>場 次 資 訊</PanelTitle>
              <dl className="space-y-1.5 text-sm">
                <Row label="場次" value={<CodeStamp code={data.session.code} />} />
                {data.me.nickname ? <Row label="暱稱" value={data.me.nickname} /> : null}
                <Row label="最終階段" value={data.session.finalStage || "—"} />
                <Row
                  label="結束時間"
                  value={data.session.endedAt ? formatTime(data.session.endedAt) : "—"}
                />
              </dl>
            </Panel>

            <Panel className="p-3.5">
              <PanelTitle>我 的 紀 錄</PanelTitle>
              {data.log.length === 0 ? (
                <p className="py-3 text-center text-xs text-muted/70">沒有紀錄</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.log.map((e, i) => (
                    <li key={i} className="flex items-baseline gap-2 text-xs">
                      <span className="tabular shrink-0 text-[10px] text-muted/50">
                        {formatTime(e.ts)}
                      </span>
                      <span className="min-w-0 flex-1 text-paper/80">{e.reason || "—"}</span>
                      {e.delta !== "" ? (
                        <span
                          className={`tabular shrink-0 ${
                            Number(e.delta) >= 0 ? "text-jade-soft" : "text-vermilion-soft"
                          }`}
                        >
                          {Number(e.delta) >= 0 ? "+" : ""}
                          {e.delta} {e.resource}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        ) : null}

        {data ? (
          <p className="py-1 text-center text-[11px] leading-relaxed text-muted/50">
            場次已結束，這裡的內容不會再變動。
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2/60 px-3 py-3 text-center">
      <p className="text-[11px] tracking-widest text-muted">{label}</p>
      <p className={`tabular mt-1 text-2xl font-bold ${accent}`}>{value}</p>
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
