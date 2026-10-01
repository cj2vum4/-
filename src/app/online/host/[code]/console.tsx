"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, SectionTitle, ShellHeader, type TabDef } from "@/components/mobile-shell";
import { Button, CodeStamp, Field, Notice, PageShell, Panel, PanelTitle } from "@/components/ui";
import {
  ApiError,
  clearHostPin,
  loadHostPin,
  onlineApi,
  saveHostPin,
  useOnlineHost,
} from "@/lib/online/client";
import { metaForCode } from "@/lib/online/meta";
import type { HostCatalog, HostClue, OnlineHostSnapshot, UnlockDef } from "@/lib/online/types";
import { CircleBoard } from "../../circle";
import { HostPokerPanel } from "../../poker";
import { RichText } from "../../rich-text";

type Tab = "flow" | "clues" | "players" | "broadcast" | "book";

/** 一次最多畫這麼多張線索卡；瘋兔子有好幾百頁 OCR，全畫出來手機會卡 */
const PAGE = 40;

export function HostConsole({ code }: { code: string }) {
  const meta = metaForCode(code);
  const [pin, setPin] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPin(loadHostPin(code));
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
      {pin ? (
        <Console code={code} pin={pin} onLogout={() => (clearHostPin(code), setPin(""))} />
      ) : (
        <PinGate code={code} onPin={(p) => (saveHostPin(code, p), setPin(p))} />
      )}
    </div>
  );
}

function PinGate({ code, onPin }: { code: string; onPin: (pin: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  async function submit() {
    try {
      await onlineApi(`/${code}/state`, { pin: value });
      onPin(value);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "驗證失敗");
    }
  }
  return (
    <PageShell>
      <Panel>
        <PanelTitle>主持台 {code}</PanelTitle>
        <div className="space-y-3">
          <Field label="主持密碼" value={value} onChange={(e) => setValue(e.target.value)} />
          {error ? <Notice>{error}</Notice> : null}
          <Button className="w-full" disabled={!value} onClick={submit}>
            進入主持台
          </Button>
        </div>
      </Panel>
    </PageShell>
  );
}

function Console({ code, pin, onLogout }: { code: string; pin: string; onLogout: () => void }) {
  const { data: snap, setData, error: pollError } = useOnlineHost(code, pin);
  const [catalog, setCatalog] = useState<HostCatalog | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [tab, setTab] = useState<Tab>("flow");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  const loadCatalog = useCallback(async () => {
    setCatalogError("");
    try {
      const r = await onlineApi<{ catalog: HostCatalog }>(`/${code}/catalog`, { pin });
      setCatalog(r.catalog);
    } catch (err) {
      setCatalogError(err instanceof ApiError ? err.message : "線索載入失敗");
    }
  }, [code, pin]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const act = useCallback(
    async (body: Record<string, unknown>, done?: string) => {
      setBusy(true);
      try {
        const r = await onlineApi<{ host: OnlineHostSnapshot }>(`/${code}/host`, {
          method: "POST",
          pin,
          body: JSON.stringify(body),
        });
        setData(r.host);
        if (done) setToast(done);
      } catch (err) {
        setToast(err instanceof ApiError ? err.message : "操作失敗");
      } finally {
        setBusy(false);
      }
    },
    [code, pin, setData],
  );

  if (pollError?.code === "UNAUTHORIZED") {
    return (
      <PageShell>
        <Notice>主持密碼不正確或已變更。</Notice>
        <Button className="mt-4 w-full" onClick={onLogout}>
          重新輸入密碼
        </Button>
      </PageShell>
    );
  }
  if (pollError?.code === "SESSION_NOT_FOUND") {
    return (
      <PageShell>
        <Notice>找不到場次 {code}。</Notice>
      </PageShell>
    );
  }

  const onlineCount = snap?.seats.filter((s) => s.online).length ?? 0;
  const tabs: TabDef[] = [
    { id: "flow", label: "流程", glyph: "序" },
    { id: "clues", label: "線索", glyph: "證" },
    { id: "players", label: "玩家", glyph: "人", badge: snap ? snap.seats.length : undefined },
    { id: "broadcast", label: "廣播", glyph: "告" },
    { id: "book", label: "手冊", glyph: "冊" },
  ];

  return (
    <AppShell
      wide
      tabs={tabs}
      active={tab}
      onTabChange={(id) => setTab(id as Tab)}
      header={
        <ShellHeader
          backHref="/online"
          title={
            <>
              <CodeStamp code={code} />
              <span className="truncate">{catalog?.title ?? "主持台"}</span>
            </>
          }
          subtitle={
            snap
              ? `${snap.status === "ended" ? "已結束" : "進行中"} · ${
                  catalog?.phases[snap.phase]?.name ?? ""
                } · ${onlineCount} 人在線`
              : "連線中…"
          }
        />
      }
    >
      {toast ? (
        <div className="fixed inset-x-0 top-16 z-20 flex justify-center px-4">
          <div className="fade-up rounded-lg border border-gold/50 bg-panel px-4 py-2 text-sm text-gold-soft shadow-lg">
            {toast}
          </div>
        </div>
      ) : null}
      {pollError && pollError.code === "NETWORK" ? <Notice>{pollError.message}</Notice> : null}
      {catalogError ? (
        <div className="mb-3">
          <Notice>
            {catalogError}{" "}
            <button className="underline" onClick={loadCatalog}>
              重試
            </button>
          </Notice>
        </div>
      ) : null}

      {!snap || !catalog ? (
        <p className="py-10 text-center text-sm text-muted">載入中…</p>
      ) : tab === "flow" ? (
        <FlowTab code={code} snap={snap} catalog={catalog} busy={busy} act={act} />
      ) : tab === "clues" ? (
        <CluesTab snap={snap} catalog={catalog} busy={busy} act={act} reload={loadCatalog} />
      ) : tab === "players" ? (
        <PlayersTab code={code} snap={snap} catalog={catalog} busy={busy} act={act} />
      ) : tab === "broadcast" ? (
        <BroadcastTab snap={snap} catalog={catalog} busy={busy} act={act} />
      ) : (
        <BookTab catalog={catalog} />
      )}
    </AppShell>
  );
}

type Act = (body: Record<string, unknown>, done?: string) => Promise<void>;

function FlowTab({
  code,
  snap,
  catalog,
  busy,
  act,
}: {
  code: string;
  snap: OnlineHostSnapshot;
  catalog: HostCatalog;
  busy: boolean;
  act: Act;
}) {
  const ended = snap.status === "ended";
  // 劇本段落分三種：放在階段卡片裡的（小劇場）、切階段就自動開的（各幕）、其他要手動開的（信件、第二本）
  const phaseNames = new Set(catalog.phases.map((p) => p.name));
  const autoKeys = new Set(catalog.phases.map((p) => p.unlock).filter(Boolean));
  const stepUnlocks = new Map<string, UnlockDef[]>();
  for (const u of catalog.unlocks) {
    if (u.phase && phaseNames.has(u.phase)) stepUnlocks.set(u.phase, [...(stepUnlocks.get(u.phase) ?? []), u]);
  }
  const rest = catalog.unlocks.filter((u) => !(u.phase && phaseNames.has(u.phase)));
  const manual = rest.filter((u) => !autoKeys.has(u.key));
  const automatic = rest.filter((u) => autoKeys.has(u.key));
  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle>場次</SectionTitle>
        <p className="text-sm text-muted">
          請玩家打開 <span className="text-paper">/online/join</span> 並輸入代碼{" "}
          <CodeStamp code={code} />，或到「玩家」分頁複製入場連結。
        </p>
        {ended ? (
          <p className="mt-3 text-sm text-vermilion-soft">場次已結束，玩家仍可回來看已拿到的內容。</p>
        ) : (
          <Button
            variant="danger"
            size="sm"
            className="mt-3"
            disabled={busy}
            onClick={() => {
              if (window.confirm("確定要結束場次嗎？結束後不能再發放線索。")) void act({ action: "end" }, "場次已結束");
            }}
          >
            結束場次
          </Button>
        )}
      </Panel>

      <div>
        <SectionTitle>遊戲階段</SectionTitle>
        <ol className="space-y-2">
          {catalog.phases.map((p, i) => {
            const current = i === snap.phase;
            return (
              <li
                key={p.name}
                className={`rounded-lg border px-3.5 py-3 ${
                  current ? "border-gold bg-gold/10" : i < snap.phase ? "border-line bg-panel/60 opacity-70" : "border-line bg-panel"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-muted">
                      第 {i + 1} 階段{p.time ? ` · ${p.time}` : ""}
                      {p.unlock ? ` · 自動開放 ${p.unlock}` : ""}
                    </div>
                    <div className={`font-bold ${current ? "text-gold-soft" : "text-paper"}`}>{p.name}</div>
                    <p className="mt-1 text-xs leading-relaxed text-muted">{p.desc}</p>
                  </div>
                  {current ? (
                    <span className="shrink-0 rounded-full border border-gold/60 px-2 py-0.5 text-xs text-gold-soft">進行中</span>
                  ) : (
                    <Button
                      size="sm"
                      variant={i === snap.phase + 1 ? "primary" : "ghost"}
                      disabled={busy || ended}
                      onClick={() => act({ action: "phase", phase: i }, `已切換到「${p.name}」`)}
                    >
                      {i < snap.phase ? "退回" : "切換"}
                    </Button>
                  )}
                </div>
                {stepUnlocks.has(p.name) ? (
                  // 這一幕中途要手動開的段落（小劇場、故事覆盤），按鈕直接放在階段卡片裡
                  <ul className="mt-2.5 space-y-2 border-t border-line/60 pt-2.5">
                    {stepUnlocks.get(p.name)!.map((u) => (
                      <UnlockRow
                        key={u.key}
                        unlock={u}
                        label={u.title.split("·").pop()!.trim()}
                        snap={snap}
                        busy={busy || ended}
                        act={act}
                        enter={u.title.includes("小劇場")}
                      />
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>

      {manual.length || automatic.length ? (
        <div>
          <SectionTitle>劇本開放</SectionTitle>
          {manual.length ? (
            <>
              <p className="mb-2 text-xs text-muted">控制玩家端劇本各幕與信件是否可讀。第二本在「開放第二本劇本」之前，玩家端完全看不到。</p>
              <ul className="space-y-2">
                {manual.map((u) => (
                  <UnlockRow key={u.key} unlock={u} label={u.title} snap={snap} busy={busy || ended} act={act} boxed />
                ))}
              </ul>
            </>
          ) : null}
          {automatic.length ? (
            <details className={`rounded-lg border border-line bg-panel/60 ${manual.length ? "mt-2" : ""}`}>
              <summary className="cursor-pointer px-3.5 py-2.5 text-xs text-muted">
                各幕劇本：切換階段時會自動開放，通常不用動（{automatic.filter((u) => snap.unlocks[u.key]).length}/{automatic.length} 已開放）
              </summary>
              <ul className="space-y-2 border-t border-line/60 px-3.5 py-2.5">
                {automatic.map((u) => (
                  <UnlockRow key={u.key} unlock={u} label={u.title} snap={snap} busy={busy || ended} act={act} />
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 一個劇本段落的開放開關（再按一次會關上）。
 * enter：階段卡片裡的小劇場，按鈕寫「進入小劇場」，比「開放」直覺
 */
function UnlockRow({
  unlock: u,
  label,
  snap,
  busy,
  act,
  boxed = false,
  enter = false,
}: {
  unlock: UnlockDef;
  label: string;
  snap: OnlineHostSnapshot;
  busy: boolean;
  act: Act;
  boxed?: boolean;
  enter?: boolean;
}) {
  const on = Boolean(snap.unlocks[u.key]);
  const off = enter ? `進入${label.replace(/（.*?）/g, "")}` : "開放";
  return (
    <li className={`flex items-center justify-between gap-3 ${boxed ? "rounded-lg border border-line bg-panel px-3.5 py-2.5" : ""}`}>
      <div className="min-w-0">
        <div className="text-sm text-paper">
          {label}
          {u.announce ? <span className="ml-1.5 text-[11px] text-muted">📖 開放時通知玩家翻頁</span> : null}
        </div>
        <div className="text-xs text-muted">{u.desc}</div>
      </div>
      <Button
        size="sm"
        variant={on ? "jade" : "ghost"}
        className="shrink-0"
        disabled={busy}
        onClick={() => act({ action: "unlock", key: u.key, on: !on }, on ? `已關閉：${u.title}` : `已開放：${u.title}`)}
      >
        {on ? (enter ? "已進入" : "已開放") : off}
      </Button>
    </li>
  );
}

function roleName(catalog: HostCatalog, id: string) {
  return id === "all" ? "全體" : catalog.roles.find((r) => r.id === id)?.name ?? id;
}

function CluesTab({
  snap,
  catalog,
  busy,
  act,
  reload,
}: {
  snap: OnlineHostSnapshot;
  catalog: HostCatalog;
  busy: boolean;
  act: Act;
  reload: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [filter, setFilter] = useState<"all" | "sent" | "unsent">("all");
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.clues.filter((c) => {
      if (group && c.group !== group) return false;
      const sent = Boolean(snap.released[c.id]);
      if (filter === "sent" && !sent) return false;
      if (filter === "unsent" && sent) return false;
      if (!q) return true;
      return [c.id, c.title, c.summary, c.body].some((t) => t.toLowerCase().includes(q));
    });
  }, [catalog.clues, group, filter, query, snap.released]);

  const groups = catalog.groups.filter((g) => !group || g.id === group);
  let shown = 0;
  // 依幕摺疊：本幕展開，前面與後面幾幕各收進一個摺疊區；搜尋或選了分類時全部攤開
  const fold = snap.clueGroups && !query.trim() && !group ? snap.clueGroups : null;
  const past = new Set(fold?.filter((g) => g.past).map((g) => g.id));
  const current = fold?.find((g) => !g.past)?.id;

  const section = (g: (typeof groups)[number], paged: boolean) => {
    const items = filtered.filter((c) => c.group === g.id);
    if (!items.length) return null;
    const room = paged ? Math.max(0, limit - shown) : items.length;
    const visible = items.slice(0, room);
    if (paged) shown += visible.length;
    if (!visible.length) return null;
    const bulk =
      items.some((c) => c.audience !== "pick") || catalog.unlocks.some((u) => u.group === g.id && !u.phase);
    // 小劇場之類要在特定步驟開的段落不會跟著開，確認視窗講清楚
    const steps = catalog.unlocks.filter((u) => u.group === g.id && u.phase);
    return (
      <section key={g.id}>
        <SectionTitle
          extra={
            bulk ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || snap.status === "ended"}
                onClick={() => {
                  if (
                    window.confirm(
                      `把「${g.label}」的線索全部依預設對象發出，並開放本幕劇本？` +
                        (steps.length ? `\n\n${steps.map((u) => u.title).join("、")}不會一起開，請到「流程」分頁在對應步驟單獨開放。` : ""),
                    )
                  )
                    void act({ action: "releaseGroup", group: g.id }, `已全部開放：${g.label}`);
                }}
              >
                全部開放
              </Button>
            ) : null
          }
        >
          {g.label}
        </SectionTitle>
        <div className="space-y-2">
          {visible.map((c) => (
            <ClueCard key={c.id} clue={c} snap={snap} catalog={catalog} busy={busy} act={act} />
          ))}
        </div>
      </section>
    );
  };
  const count = (ids: Set<string>) => filtered.filter((c) => ids.has(c.group)).length;
  const foldBox = (label: string, list: typeof groups) =>
    list.length && count(new Set(list.map((g) => g.id))) ? (
      <details className="rounded-xl border border-line/70 bg-panel/50">
        <summary className="cursor-pointer px-3.5 py-2.5 text-xs text-muted">
          {label}（{count(new Set(list.map((g) => g.id)))}）：{list.map((g) => g.label).join("、")}
        </summary>
        <div className="space-y-4 border-t border-line/60 px-3 py-3">{list.map((g) => section(g, false))}</div>
      </details>
    ) : null;

  return (
    <div className="space-y-4">
      {catalog.clueSourceNote ? (
        <Notice>
          {catalog.clueSourceNote}{" "}
          <button className="underline" onClick={() => void reload()}>
            重新載入
          </button>
        </Notice>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input
          value={query}
          onChange={(e) => (setQuery(e.target.value), setLimit(PAGE))}
          placeholder="搜尋線索標題、代碼或內文"
          className="rounded-lg border border-line bg-lacquer px-3 py-2.5 text-sm text-paper outline-none focus:border-gold/70"
        />
        <select
          value={group}
          onChange={(e) => (setGroup(e.target.value), setLimit(PAGE))}
          className="rounded-lg border border-line bg-lacquer px-3 py-2.5 text-sm text-paper"
        >
          <option value="">所有分類</option>
          {catalog.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="rounded-lg border border-line bg-lacquer px-3 py-2.5 text-sm text-paper"
        >
          <option value="all">全部</option>
          <option value="unsent">未發放</option>
          <option value="sent">已發放</option>
        </select>
      </div>
      <p className="text-xs text-muted">
        顯示 {fold ? filtered.length : Math.min(filtered.length, limit)} / {filtered.length} 筆（共 {catalog.clues.length} 筆線索）
      </p>

      {fold ? (
        <>
          {groups.filter((g) => g.id === current).map((g) => section(g, false))}
          {foldBox("後面幾幕的線索", groups.filter((g) => g.id !== current && !past.has(g.id)))}
          {foldBox("前面幾幕的線索", groups.filter((g) => past.has(g.id)))}
        </>
      ) : (
        groups.map((g) => section(g, true))
      )}

      {!fold && filtered.length > limit ? (
        <Button variant="ghost" className="w-full" onClick={() => setLimit((l) => l + PAGE)}>
          顯示更多
        </Button>
      ) : null}
    </div>
  );
}

function ClueCard({
  clue,
  snap,
  catalog,
  busy,
  act,
}: {
  clue: HostClue;
  snap: OnlineHostSnapshot;
  catalog: HostCatalog;
  busy: boolean;
  act: Act;
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(catalog.roles[0]?.id ?? "");
  const rel = snap.released[clue.id];
  const extraHolders = snap.seats.filter((s) => s.extra.includes(clue.id)).map((s) => roleName(catalog, s.roleId));
  const ended = snap.status === "ended";
  const targets = clue.targets ?? (clue.target ? [clue.target] : []);
  const defaultLabel =
    clue.audience === "all"
      ? "發給全體"
      : clue.audience === "role" && targets.length
        ? `發給${targets.map((id) => roleName(catalog, id)).join("、")}`
        : "";

  return (
    <article className={`rounded-lg border px-3.5 py-3 ${rel ? "border-jade/50 bg-jade/5" : "border-line bg-panel"}`}>
      <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen((o) => !o)}>
        <div className="min-w-0">
          <div className="font-bold text-paper">{clue.title}</div>
          <div className="mt-0.5 text-xs text-muted">
            <span className="tabular text-gold/80">{clue.id}</span>
            {clue.pageNum ? ` · 第 ${clue.pageNum} 頁` : ""}
            {clue.summary ? ` · ${clue.summary}` : ""}
          </div>
        </div>
        <span className={`shrink-0 text-xs ${rel ? "text-jade-soft" : "text-muted"}`}>
          {rel ? `已發：${rel.to.map((id) => roleName(catalog, id)).join("、")}` : "未發放"}
        </span>
      </button>
      {extraHolders.length ? (
        <p className="mt-1 text-xs text-gold/80">玩家自行輸入代碼：{extraHolders.join("、")}</p>
      ) : null}

      {open ? (
        <div className="mt-3 space-y-2">
          {clue.hostNote ? (
            <p className="whitespace-pre-wrap rounded-md border border-gold/30 bg-gold/5 px-3 py-2 text-xs leading-relaxed text-gold-soft">
              {clue.hostNote}
            </p>
          ) : null}
          {clue.body ? (
            <p className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md bg-lacquer px-3 py-2 text-sm leading-relaxed text-paper/90">
              {clue.body}
            </p>
          ) : null}
          {clue.images.length ? (
            <div className="flex flex-wrap gap-2">
              {clue.images.map((src) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={src} src={src} alt={clue.title} loading="lazy" className="max-h-40 rounded-md" />
              ))}
            </div>
          ) : null}
          {clue.widget === "poker" ? <HostPokerPanel poker={snap.poker} roles={catalog.roles} busy={busy || ended} act={act} /> : null}
          {clue.widget === "circle" && snap.circle ? (
            <div className="rounded-lg border border-gold/30 bg-gold/5 p-3">
              <CircleBoard circle={snap.circle} host busy={busy || ended} onOp={(op) => void act({ action: "circle", ...op })} />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {defaultLabel ? (
          <Button size="sm" disabled={busy || ended} onClick={() => act({ action: "release", clueId: clue.id, to: "default" }, `已${defaultLabel}：${clue.title}`)}>
            {defaultLabel}
          </Button>
        ) : null}
        {clue.audience !== "all" ? (
          <Button size="sm" variant="ghost" disabled={busy || ended} onClick={() => act({ action: "release", clueId: clue.id, to: "all" }, `已發給全體：${clue.title}`)}>
            發給全體
          </Button>
        ) : null}
        <span className="flex items-center gap-1">
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="rounded-md border border-line bg-lacquer px-2 py-1.5 text-xs text-paper"
            aria-label="指定角色"
          >
            {catalog.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" disabled={busy || ended} onClick={() => act({ action: "release", clueId: clue.id, to: pick }, `已發給${roleName(catalog, pick)}：${clue.title}`)}>
            發給指定角色
          </Button>
        </span>
        {rel || extraHolders.length ? (
          <Button size="sm" variant="danger" disabled={busy || ended} onClick={() => act({ action: "revoke", clueId: clue.id }, `已收回：${clue.title}`)}>
            收回
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function PlayersTab({
  code,
  snap,
  catalog,
  busy,
  act,
}: {
  code: string;
  snap: OnlineHostSnapshot;
  catalog: HostCatalog;
  busy: boolean;
  act: Act;
}) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const link = `${origin}/online/join?code=${code}`;
  const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});

  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle>玩家入場連結</SectionTitle>
        <button type="button" onClick={() => copy(link)} className="w-full break-all rounded-md bg-lacquer px-3 py-2 text-left text-sm text-gold-soft">
          {link}
        </button>
        <p className="mt-1 text-xs text-muted">點一下複製。也可以用下面每個角色專屬的連結，玩家打開就預選好角色。</p>
      </Panel>

      <ul className="grid gap-2 sm:grid-cols-2">
        {catalog.roles.map((r) => {
          const seat = snap.seats.find((s) => s.roleId === r.id);
          return (
            <li key={r.id} className="rounded-lg border border-line bg-panel px-3.5 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold text-paper">{r.name}</div>
                <span className={`flex items-center gap-1.5 text-xs ${seat?.online ? "text-jade-soft" : "text-muted"}`}>
                  <span className={`h-2 w-2 rounded-full ${seat?.online ? "bg-jade" : "bg-line"}`} />
                  {seat ? (seat.online ? "在線" : "離線") : "等待加入"}
                </span>
              </div>
              <div className="mt-1 text-sm text-gold-soft">{seat?.nickname ?? "—"}</div>
              <p className="mt-1 text-xs text-muted">{r.desc}</p>
              {r.hint ? <p className="mt-0.5 text-xs text-gold/70">{r.hint}</p> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => copy(`${link}&role=${r.id}`)}>
                  複製專屬連結
                </Button>
                {seat ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`釋出「${r.name}」？${seat.nickname} 會被登出，角色可以讓別人重新選。`))
                        void act({ action: "freeSeat", roleId: r.id }, `已釋出：${r.name}`);
                    }}
                  >
                    釋出角色
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function BroadcastTab({
  snap,
  catalog,
  busy,
  act,
}: {
  snap: OnlineHostSnapshot;
  catalog: HostCatalog;
  busy: boolean;
  act: Act;
}) {
  const [text, setText] = useState("");
  const ended = snap.status === "ended";
  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle>廣播給所有玩家</SectionTitle>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          rows={3}
          placeholder="例如：第二幕開始，請前往下一個場景"
          className="w-full rounded-lg border border-line bg-lacquer px-3 py-2.5 text-sm text-paper outline-none focus:border-gold/70"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {catalog.templates.map((t) => (
            <Button key={t.label} size="sm" variant="ghost" onClick={() => setText(t.message)}>
              {t.label}
            </Button>
          ))}
        </div>
        <Button
          className="mt-3 w-full"
          disabled={busy || ended || !text.trim()}
          onClick={async () => {
            await act({ action: "broadcast", message: text }, "廣播已送出");
            setText("");
          }}
        >
          送出廣播
        </Button>
      </Panel>
      <div>
        <SectionTitle>廣播紀錄</SectionTitle>
        {snap.broadcasts.length ? (
          <ul className="space-y-2">
            {snap.broadcasts.map((b) => (
              <li key={b.id} className={`rounded-md border-l-2 bg-panel px-3 py-2 text-sm ${b.kind === "system" ? "border-gold" : "border-jade"}`}>
                <div className="text-xs text-muted">{new Date(b.at).toLocaleTimeString("zh-TW")}</div>
                <div className="whitespace-pre-wrap text-paper">{b.message}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">尚無廣播。</p>
        )}
      </div>
    </div>
  );
}

function BookTab({ catalog }: { catalog: HostCatalog }) {
  return (
    <div className="space-y-3">
      {catalog.handbook.map((h, i) => (
        // 手冊段落很長（瘋兔子的 DM 手冊一幕就上萬字），預設只展開第一段
        <details key={h.title} open={i === 0} className="rounded-xl border border-line bg-panel/80">
          <summary className="cursor-pointer px-4 py-3 text-sm font-bold tracking-[0.15em] text-gold/90">{h.title}</summary>
          <div className="border-t border-line/60 px-4 py-3">
            {h.note ? <RichText text={h.note} images={h.images} className="whitespace-pre-wrap text-sm leading-relaxed text-paper/85" /> : null}
            {h.rows.length ? (
              <table className="mt-2 w-full text-left text-sm">
                <tbody>
                  {h.rows.map((row, r) => (
                    <tr key={r} className="border-t border-line/60 align-top">
                      {row.map((cell, j) => (
                        <td key={j} className={`whitespace-pre-wrap py-2 pr-3 ${j === 0 ? "text-gold/80 tabular" : "text-paper/90"}`}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        </details>
      ))}
      <details className="rounded-xl border border-line bg-panel/80">
        <summary className="cursor-pointer px-4 py-3 text-sm font-bold tracking-[0.15em] text-gold/90">各階段流程</summary>
        <ol className="space-y-2 border-t border-line/60 px-4 py-3 text-sm">
          {catalog.phases.map((p, i) => (
            <li key={p.name}>
              <span className="text-gold/80">
                {i + 1}. {p.name}
              </span>
              {p.time ? <span className="text-xs text-muted"> · {p.time}</span> : null}
              <p className="text-xs text-muted">{p.desc}</p>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
