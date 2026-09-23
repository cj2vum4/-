"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell, SectionTitle, ShellHeader, type TabDef } from "@/components/mobile-shell";
import { BackLink, Button, Field, Notice, PageShell } from "@/components/ui";
import {
  ApiError,
  clearIdentity,
  loadIdentity,
  onlineApi,
  saveIdentity,
  useOnlinePlayer,
} from "@/lib/online/client";
import { metaForCode } from "@/lib/online/meta";
import type { OnlineLobby, OnlinePlayerIdentity, OnlinePlayerSnapshot } from "@/lib/online/types";

export function PlayerApp({ code }: { code: string }) {
  const meta = metaForCode(code);
  const [identity, setIdentity] = useState<OnlinePlayerIdentity | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setIdentity(loadIdentity(code));
    setReady(true);
  }, [code]);

  if (!meta) {
    return (
      <PageShell>
        <Notice>場次代碼格式不正確</Notice>
      </PageShell>
    );
  }
  if (!ready) return null;

  return (
    <div className={meta.theme}>
      {identity ? (
        <Panel
          identity={identity}
          onLeave={() => {
            clearIdentity(code);
            setIdentity(null);
          }}
        />
      ) : (
        <Lobby
          code={code}
          onJoined={(id) => {
            saveIdentity(id);
            setIdentity(id);
          }}
        />
      )}
    </div>
  );
}

function Lobby({ code, onJoined }: { code: string; onJoined: (id: OnlinePlayerIdentity) => void }) {
  const params = useSearchParams();
  const [lobby, setLobby] = useState<OnlineLobby | null>(null);
  const [error, setError] = useState("");
  const [roleId, setRoleId] = useState(params.get("role") ?? "");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await onlineApi<{ lobby: OnlineLobby }>(`/${code}/lobby`);
      setLobby(r.lobby);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "讀取場次失敗");
    }
  }, [code]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function join() {
    setBusy(true);
    setError("");
    try {
      const r = await onlineApi<{ identity: OnlinePlayerIdentity }>(`/${code}/join`, {
        method: "POST",
        body: JSON.stringify({ roleId, nickname }),
      });
      onJoined(r.identity);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "入場失敗");
      void load();
    } finally {
      setBusy(false);
    }
  }

  const selected = lobby?.roles.find((r) => r.id === roleId);

  return (
    <PageShell>
      <BackLink href="/online/join" label="換一個場次" />
      <p className="mt-4 text-xs tracking-[0.3em] text-muted">場次 {code}</p>
      <h1 className="mt-1 text-2xl font-bold text-gold-soft">{lobby?.title ?? "讀取中…"}</h1>
      {lobby?.status === "ended" ? (
        <p className="mt-2 text-sm text-vermilion-soft">這一場已經結束。原本的玩家可以用相同角色與暱稱回來看紀錄。</p>
      ) : (
        <p className="mt-2 text-sm text-muted">選擇主持人分配給你的角色，並留下暱稱。</p>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2">
        {lobby?.roles.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRoleId(r.id)}
            className={`rounded-lg border px-3 py-3 text-left transition-colors ${
              r.id === roleId ? "border-gold bg-gold/10" : "border-line bg-panel"
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="font-bold text-paper">{r.name}</span>
              {r.taken ? <span className="text-[11px] text-muted">已有人</span> : null}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted">{r.desc}</span>
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-3">
        <Field
          label="你的暱稱"
          hint={selected?.taken ? "這個角色已經有人選了。若是你本人（換手機或重新整理），請輸入當初的暱稱。" : "主持人會用這個名字稱呼你。"}
          maxLength={20}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
        {error ? <Notice>{error}</Notice> : null}
        <Button className="w-full" disabled={busy || !roleId || !nickname.trim()} onClick={join}>
          {selected ? `以「${selected.name}」入場` : "請先選擇角色"}
        </Button>
      </div>
    </PageShell>
  );
}

type Tab = "script" | "clues" | "news" | "me";

function Panel({ identity, onLeave }: { identity: OnlinePlayerIdentity; onLeave: () => void }) {
  const { data: snap, error } = useOnlinePlayer(identity);
  const hasDocs = Boolean(snap?.docs.length);
  const [tab, setTab] = useState<Tab | null>(null);
  const active: Tab = tab ?? (hasDocs ? "script" : "clues");

  // 新線索／新廣播的紅點與提示
  const [seenClues, setSeenClues] = useState<number | null>(null);
  const [seenNews, setSeenNews] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const prev = useRef<{ clues: number; news: number } | null>(null);

  useEffect(() => {
    if (!snap) return;
    const now = { clues: snap.clues.length, news: snap.broadcasts.length };
    if (prev.current) {
      if (now.clues > prev.current.clues) setToast("📨 收到新線索！");
      else if (now.news > prev.current.news) setToast(`📢 ${snap.broadcasts[0]?.message.slice(0, 40) ?? "主持人有新通知"}`);
    } else {
      setSeenClues(now.clues);
      setSeenNews(now.news);
    }
    prev.current = now;
  }, [snap]);

  useEffect(() => {
    if (active === "clues" && snap) setSeenClues(snap.clues.length);
    if (active === "news" && snap) setSeenNews(snap.broadcasts.length);
  }, [active, snap]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  if (error?.code === "UNAUTHORIZED" || error?.code === "SESSION_NOT_FOUND") {
    return (
      <PageShell>
        <Notice>{error.message}</Notice>
        <Button className="mt-4 w-full" onClick={onLeave}>
          重新選角入場
        </Button>
      </PageShell>
    );
  }
  if (!snap) {
    return (
      <PageShell>
        <p className="py-10 text-center text-sm text-muted">{error ? error.message : "連線中…"}</p>
      </PageShell>
    );
  }

  const newClues = Math.max(0, snap.clues.length - (seenClues ?? snap.clues.length));
  const newNews = Math.max(0, snap.broadcasts.length - (seenNews ?? snap.broadcasts.length));
  const tabs: TabDef[] = [
    ...(hasDocs ? [{ id: "script", label: "劇本", glyph: "本" }] : []),
    { id: "clues", label: "線索", glyph: "證", badge: newClues || undefined },
    { id: "news", label: "廣播", glyph: "告", badge: newNews || undefined },
    { id: "me", label: "角色", glyph: "我" },
  ];

  return (
    <AppShell
      tabs={tabs}
      active={active}
      onTabChange={(id) => setTab(id as Tab)}
      header={
        <ShellHeader
          title={
            <>
              <span className="text-gold-soft">{snap.role.name}</span>
              <span className="text-sm font-normal text-muted">· {snap.nickname}</span>
            </>
          }
          subtitle={snap.status === "ended" ? "場次已結束" : `目前：${snap.phaseName || "等待開始"}`}
        />
      }
    >
      {toast ? (
        <div className="fixed inset-x-0 top-16 z-20 flex justify-center px-4">
          <div className="fade-up rounded-lg border border-gold/50 bg-panel px-4 py-2 text-sm text-gold-soft shadow-lg">{toast}</div>
        </div>
      ) : null}
      {error?.code === "NETWORK" ? (
        <div className="mb-3">
          <Notice>{error.message}</Notice>
        </div>
      ) : null}
      {active === "script" ? (
        <ScriptTab snap={snap} />
      ) : active === "clues" ? (
        <CluesTab snap={snap} identity={identity} />
      ) : active === "news" ? (
        <NewsTab snap={snap} />
      ) : (
        <MeTab snap={snap} onLeave={onLeave} />
      )}
    </AppShell>
  );
}

function ScriptTab({ snap }: { snap: OnlinePlayerSnapshot }) {
  const books = useMemo(() => [...new Set(snap.docs.map((d) => d.book))], [snap.docs]);
  const [book, setBook] = useState(books[0] ?? "");
  const docs = snap.docs.filter((d) => d.book === (books.includes(book) ? book : books[0]));
  const firstOpen = docs.findIndex((d) => d.body !== null);
  const [idx, setIdx] = useState<number | null>(null);
  const current = docs[idx ?? Math.max(0, lastOpen(docs))];

  if (firstOpen === -1 && !snap.docs.some((d) => d.body !== null)) {
    return (
      <div className="py-16 text-center text-muted">
        <div className="text-4xl">⏳</div>
        <p className="mt-3 text-sm">等待主持人開始遊戲</p>
        {snap.hint ? <p className="mt-4 text-xs italic">{snap.hint}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {books.length > 1 ? (
        <div className="flex gap-2">
          {books.map((b) => (
            <Button key={b} size="sm" variant={b === book ? "primary" : "ghost"} onClick={() => (setBook(b), setIdx(null))}>
              {b}
            </Button>
          ))}
        </div>
      ) : null}
      <nav className="flex gap-1.5 overflow-x-auto pb-1">
        {docs.map((d, i) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setIdx(i)}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs ${
              d === current ? "border-gold bg-gold/15 text-gold-soft" : d.body === null ? "border-line text-muted/50" : "border-line text-paper/80"
            }`}
          >
            {d.body === null ? "🔒 " : ""}
            {d.title.split("·")[0].trim()}
          </button>
        ))}
      </nav>
      {current ? (
        <article className="rounded-xl border border-line bg-panel px-4 py-5">
          <h2 className="mb-3 font-bold text-gold-soft">{current.title}</h2>
          {current.body === null ? (
            <p className="py-8 text-center text-sm text-muted">🔒 等待主持人開放此段</p>
          ) : (
            <p className="whitespace-pre-wrap text-[15px] leading-8 text-paper/95">{current.body}</p>
          )}
        </article>
      ) : null}
    </div>
  );
}

/** 預設翻到最新開放的那一段 */
function lastOpen(docs: { body: string | null }[]) {
  for (let i = docs.length - 1; i >= 0; i--) if (docs[i].body !== null) return i;
  return 0;
}

function CluesTab({ snap, identity }: { snap: OnlinePlayerSnapshot; identity: OnlinePlayerIdentity }) {
  const [open, setOpen] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function unlock() {
    setMsg(null);
    try {
      const r = await onlineApi<{ title: string }>(`/${identity.code}/unlock-code`, {
        method: "POST",
        player: identity,
        body: JSON.stringify({ clueCode: code }),
      });
      setMsg({ kind: "success", text: `✅ 已解鎖：${r.title}` });
      setCode("");
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "解鎖失敗" });
    }
  }

  return (
    <div className="space-y-3">
      {snap.selfUnlock && snap.status === "active" ? (
        <div className="rounded-xl border border-line bg-panel p-3">
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && code && void unlock()}
              placeholder="輸入主持人給的線索代碼"
              autoCapitalize="characters"
              className="min-w-0 flex-1 rounded-lg border border-line bg-lacquer px-3 py-2 text-sm text-paper outline-none focus:border-gold/70"
            />
            <Button size="sm" disabled={!code.trim()} onClick={unlock}>
              解鎖
            </Button>
          </div>
          {msg ? <p className={`mt-2 text-xs ${msg.kind === "error" ? "text-vermilion-soft" : "text-jade-soft"}`}>{msg.text}</p> : null}
        </div>
      ) : null}

      <SectionTitle>我的線索（{snap.clues.length}）</SectionTitle>
      {snap.clues.length ? (
        <ul className="space-y-2">
          {snap.clues.map((c) => {
            const isOpen = open === c.id;
            return (
              <li key={c.id} className="rounded-xl border border-line bg-panel">
                <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onClick={() => setOpen(isOpen ? null : c.id)}>
                  <span className="min-w-0">
                    <span className="block font-bold text-paper">📄 {c.title}</span>
                    <span className="text-xs text-muted">{c.label}</span>
                  </span>
                  <span className="text-muted">{isOpen ? "▲" : "▼"}</span>
                </button>
                {isOpen ? (
                  <div className="border-t border-line/60 px-4 py-3">
                    {c.images.length ? (
                      <div className="mb-2 flex flex-wrap justify-center gap-2">
                        {c.images.map((src) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={src} src={src} alt={c.title} className="max-h-72 max-w-full rounded-lg" />
                        ))}
                      </div>
                    ) : null}
                    {c.body ? <p className="whitespace-pre-wrap text-sm leading-7 text-paper/95">{c.body}</p> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="py-12 text-center text-muted">
          <div className="text-3xl">🔒</div>
          <p className="mt-2 text-sm">尚未收到線索，主持人發放後會自動出現在這裡。</p>
        </div>
      )}
    </div>
  );
}

function NewsTab({ snap }: { snap: OnlinePlayerSnapshot }) {
  return snap.broadcasts.length ? (
    <ul className="space-y-2">
      {snap.broadcasts.map((b) => (
        <li key={b.id} className={`rounded-lg border-l-2 bg-panel px-4 py-3 ${b.kind === "system" ? "border-gold" : "border-jade"}`}>
          <div className="text-xs text-muted">{new Date(b.at).toLocaleTimeString("zh-TW")}</div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-paper">{b.message}</p>
        </li>
      ))}
    </ul>
  ) : (
    <p className="py-12 text-center text-sm text-muted">🔇 尚無主持人通知</p>
  );
}

function MeTab({ snap, onLeave }: { snap: OnlinePlayerSnapshot; onLeave: () => void }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-panel px-4 py-5 text-center">
        <div className="text-2xl font-bold text-gold-soft">{snap.role.name}</div>
        <p className="mt-1 text-sm text-muted">{snap.role.desc}</p>
        {snap.hint ? <p className="mt-3 text-xs italic text-muted">{snap.hint}</p> : null}
        <p className="mt-4 text-sm text-paper">暱稱：{snap.nickname}</p>
        <p className="mt-1 text-xs text-muted">場次 {snap.code}</p>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        換手機或清掉瀏覽器資料時，回到入場頁選同一個角色、輸入相同暱稱，就能拿回你的線索。
      </p>
      <Button
        variant="ghost"
        className="w-full"
        onClick={() => {
          if (window.confirm("確定要登出嗎？之後可用相同角色與暱稱回來。")) onLeave();
        }}
      >
        登出這台裝置
      </Button>
    </div>
  );
}
