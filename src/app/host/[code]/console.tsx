"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LogFeed } from "@/components/log-feed";
import { AppShell, SectionTitle, ShellHeader, type TabDef } from "@/components/mobile-shell";
import {
  BackLink,
  Button,
  CodeStamp,
  Field,
  Notice,
  PageShell,
  Panel,
  StatusPill,
} from "@/components/ui";
import {
  CHARACTER_MAP,
  DIFFICULTY_STYLE,
  FACTIONS,
  HIDDEN_BRANCHES,
  type Faction,
} from "@/lib/characters";
import {
  AUCTION_LOTS,
  AUCTION_LOT_MAP,
  EXPO_PICK_COUNT,
  LEDGER_SOURCES,
  PLAYER_COUNT_HINT,
  QUICK_DELTAS,
  RESOURCES,
  STAGES,
  STAGE_MAP,
  positionForRank,
  titleForRank,
  type LedgerSource,
} from "@/lib/config";
import { ApiError, api, clearHostPin, loadHostPin, saveHostPin } from "@/lib/client";
import { rankByPower, useHostState } from "@/lib/use-session-state";
import type { Player, ResourceKey } from "@/lib/types";

export function HostConsole({ code }: { code: string }) {
  /** null = 還在讀 localStorage，"" = 需要輸入通行碼 */
  const [pin, setPin] = useState<string | null>(null);

  useEffect(() => {
    setPin(loadHostPin(code) ?? "");
  }, [code]);

  if (pin === null) {
    return (
      <PageShell>
        <p className="py-20 text-center text-sm text-muted">讀取中…</p>
      </PageShell>
    );
  }
  if (pin === "") return <PinGate code={code} onPass={setPin} />;
  return <Console code={code} pin={pin} onPinRejected={() => setPin("")} />;
}

function PinGate({ code, onPass }: { code: string; onPass: (pin: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/sessions/${code}/verify-host`, { method: "POST", hostPin: value.trim() });
      saveHostPin(code, value.trim());
      onPass(value.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "驗證失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <BackLink href="/host" label="回開場頁" />
      <header className="mt-6 mb-5">
        <h1 className="text-xl font-bold text-paper">主持台驗證</h1>
        <p className="mt-1.5 text-sm text-muted">
          場次 <CodeStamp code={code} /> 需要開場密碼才能進入。
        </p>
      </header>
      <Panel>
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="開場密碼"
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="current-password"
          />
          {error ? <Notice>{error}</Notice> : null}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "驗證中…" : "進入主持台"}
          </Button>
        </form>
      </Panel>
    </PageShell>
  );
}

function Console({
  code,
  pin,
  onPinRejected,
}: {
  code: string;
  pin: string;
  onPinRejected: () => void;
}) {
  const { snapshot, error, loading, refresh } = useHostState(code, pin);
  const [tab, setTab] = useState("grant");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resource, setResource] = useState<ResourceKey>("power");
  const [source, setSource] = useState<LedgerSource>("主持人手動發放");
  const [reason, setReason] = useState("");
  const [custom, setCustom] = useState("");
  const [locations, setLocations] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const players = useMemo(() => rankByPower(snapshot?.players ?? []), [snapshot]);
  const session = snapshot?.session;
  const stage = session ? STAGE_MAP[session.stageId] : undefined;
  const resourceDef = RESOURCES.find((r) => r.key === resource)!;
  const quickDeltas = QUICK_DELTAS[resource];
  const pendingReports = (snapshot?.reports ?? []).filter((r) => r.verdict === "");
  const pendingSettlement = (snapshot?.reports ?? []).filter(
    (r) => r.verdict !== "" && !r.settled,
  ).length;

  const presets = stage?.presets ?? [];
  const picked = presets.filter((l) => locations.has(l.id));
  /** 勾選項目的數值加總；manual 的項目不計入，由主持人自行輸入 */
  const presetPower = picked.reduce((sum, l) => sum + (l.power ?? 0), 0);
  const presetPrestige = picked.reduce((sum, l) => sum + (l.prestige ?? 0), 0);
  const hasManual = picked.some((l) => l.manual);
  const presetReason = picked.map((l) => l.label).join("、");

  // 切換階段時把調配面板換成該階段的預設，主持人不必每次手動選
  const stageId = session?.stageId;
  useEffect(() => {
    if (!stageId) return;
    const def = STAGE_MAP[stageId];
    if (!def) return;
    setResource(def.defaultResource);
    setSource(def.defaultSource);
    setLocations(new Set());
  }, [stageId]);

  useEffect(() => {
    setSelected((prev) => {
      const alive = new Set(players.map((p) => p.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [players]);

  const flash = useCallback((kind: "success" | "error", text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 2600);
  }, []);

  const handleError = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") {
        clearHostPin(code);
        onPinRejected();
        return;
      }
      flash("error", err instanceof ApiError ? err.message : fallback);
    },
    [code, flash, onPinRejected],
  );

  async function grant(delta: number, targetAll = false) {
    if (!targetAll && selected.size === 0) {
      flash("error", "請先點選玩家，或按「全體」");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ affected: number }>(`/api/sessions/${code}/grant`, {
        method: "POST",
        hostPin: pin,
        body: JSON.stringify({
          playerIds: targetAll ? "ALL" : [...selected],
          resource,
          delta,
          source,
          reason: presetReason ? `${presetReason}${reason ? `（${reason}）` : ""}` : reason,
        }),
      });
      flash(
        "success",
        `${delta > 0 ? "發放" : "扣除"} ${Math.abs(delta)} ${resourceDef.short} 給 ${res.affected} 人`,
      );
      setCustom("");
      await refresh();
    } catch (err) {
      handleError(err, "調配失敗");
    } finally {
      setBusy(false);
    }
  }

  /** 套用勾選的快捷項目：一個項目可能同時影響勢力值與威望值，所以分兩次送 */
  async function applyPresets() {
    if (selected.size === 0) return flash("error", "請先點選要套用的玩家");
    if (presetPower === 0 && presetPrestige === 0) {
      return flash("error", "勾選的項目沒有固定數值，請用下方按鈕自行輸入");
    }
    setBusy(true);
    try {
      const targets = [...selected];
      for (const [res, delta] of [
        ["power", presetPower],
        ["prestige", presetPrestige],
      ] as const) {
        if (delta === 0) continue;
        await api(`/api/sessions/${code}/grant`, {
          method: "POST",
          hostPin: pin,
          body: JSON.stringify({
            playerIds: targets,
            resource: res,
            delta,
            source,
            reason: presetReason,
          }),
        });
      }
      flash("success", `已套用「${presetReason}」給 ${targets.length} 人`);
      setLocations(new Set());
      await refresh();
    } catch (err) {
      handleError(err, "套用失敗");
    } finally {
      setBusy(false);
    }
  }

  async function post(path: string, body: unknown, okText: string, fallback: string) {
    setBusy(true);
    try {
      await api(`/api/sessions/${code}${path}`, {
        method: "POST",
        hostPin: pin,
        body: JSON.stringify(body),
      });
      if (okText) flash("success", okText);
      await refresh();
    } catch (err) {
      handleError(err, fallback);
    } finally {
      setBusy(false);
    }
  }

  async function kick(playerId: string, name: string) {
    if (!confirm(`確定把「${name}」移出場次嗎？`)) return;
    try {
      await api(`/api/sessions/${code}/players/${playerId}`, { method: "DELETE", hostPin: pin });
      await refresh();
    } catch (err) {
      handleError(err, "移除玩家失敗");
    }
  }

  if (loading && !snapshot) {
    return (
      <PageShell>
        <p className="py-20 text-center text-sm text-muted">載入場次中…</p>
      </PageShell>
    );
  }

  if (error?.code === "SESSION_NOT_FOUND") {
    return (
      <PageShell>
        <BackLink href="/host" label="回開場頁" />
        <div className="mt-8">
          <Notice>無此場次</Notice>
        </div>
      </PageShell>
    );
  }

  const tabs: TabDef[] = [
    { id: "grant", label: "調配", glyph: "配" },
    { id: "stage", label: "階段", glyph: "幕" },
    { id: "report", label: "舉報", glyph: "劾", badge: pendingSettlement },
    { id: "setup", label: "設定", glyph: "設" },
    { id: "log", label: "紀錄", glyph: "誌" },
  ];

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <AppShell
      tabs={tabs}
      active={tab}
      onTabChange={setTab}
      header={
        <ShellHeader
          backHref="/"
          title={
            <>
              {session?.title}
              <CodeStamp code={code} />
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
      footer={
        tab === "grant" ? (
          <div className="space-y-2">
            <div className="flex gap-1.5">
              {RESOURCES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setResource(r.key)}
                  className={`flex-1 rounded-lg border py-1.5 text-xs font-bold transition-colors ${
                    resource === r.key
                      ? r.key === "prestige"
                        ? "border-gold bg-gold/15 text-gold-soft"
                        : r.key === "power"
                          ? "border-jade bg-jade/15 text-jade-soft"
                          : "border-vermilion bg-vermilion/15 text-vermilion-soft"
                      : "border-line bg-panel-2 text-muted"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div
              className={`grid gap-1.5 ${
                quickDeltas.length === 3
                  ? "grid-cols-6"
                  : quickDeltas.length === 4
                    ? "grid-cols-4"
                    : "grid-cols-5"
              }`}
            >
              {quickDeltas.map((d) => (
                <Button key={`p${d}`} size="sm" variant="jade" disabled={busy} onClick={() => grant(d)}>
                  +{d}
                </Button>
              ))}
              {quickDeltas.map((d) => (
                <Button key={`m${d}`} size="sm" variant="danger" disabled={busy} onClick={() => grant(-d)}>
                  −{d}
                </Button>
              ))}
            </div>

            <div className="flex gap-1.5">
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="自訂數值"
                inputMode="numeric"
                className="tabular min-w-0 flex-1 rounded-lg border border-line bg-lacquer px-2.5 py-1.5 text-sm text-paper outline-none placeholder:text-muted/45 focus:border-gold/70"
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !custom.trim()}
                onClick={() => {
                  const n = Number(custom);
                  if (!Number.isFinite(n) || n === 0) return flash("error", "請輸入不為零的數字");
                  void grant(n);
                }}
                className="shrink-0 px-3"
              >
                送出
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || players.length === 0}
                onClick={() => {
                  const n = Number(custom || "0");
                  if (!Number.isFinite(n) || n === 0) return flash("error", "全體發放請先填數值");
                  void grant(n, true);
                }}
                className="shrink-0 px-3"
              >
                全體
              </Button>
            </div>
          </div>
        ) : undefined
      }
    >
      {toast ? (
        <div className="mb-3">
          <Notice kind={toast.kind === "success" ? "success" : "error"}>{toast.text}</Notice>
        </div>
      ) : null}

      {/* ---------- 調配 ---------- */}
      {session?.archived ? (
        <Notice kind="info">
          本場次已結束並封存。資料已彙整成試算表裡的「{code}」分頁，
          工作分頁已刪除，這裡不能再調整任何數值。
          <br />
          玩家用原本的手機打開仍看得到自己的紀錄與聘書。
        </Notice>
      ) : null}

      {tab === "grant" ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as LedgerSource)}
              className="rounded-lg border border-line bg-lacquer px-3 py-2 text-sm text-paper outline-none focus:border-gold/70"
            >
              {LEDGER_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="事由（選填）"
              className="min-w-0 rounded-lg border border-line bg-lacquer px-3 py-2 text-sm text-paper outline-none placeholder:text-muted/45 focus:border-gold/70"
            />
          </div>

          {presets.length > 0 ? (
            <Panel className="p-3">
              <SectionTitle
                extra={
                  <span className="text-[11px] text-muted">
                    已勾 <b className="text-gold-soft">{picked.length}</b>
                    {presetPower ? (
                      <span className="ml-1.5 text-jade-soft">
                        勢力 {presetPower > 0 ? "+" : ""}
                        {presetPower}
                      </span>
                    ) : null}
                    {presetPrestige ? (
                      <span className="ml-1.5 text-gold-soft">
                        威望 {presetPrestige > 0 ? "+" : ""}
                        {presetPrestige}
                      </span>
                    ) : null}
                  </span>
                }
              >
                {stage?.hasLocations ? `地 點（${EXPO_PICK_COUNT} 選）` : "快 捷 項 目"}
              </SectionTitle>

              <div className="grid grid-cols-2 gap-1.5">
                {presets.map((l, i) => {
                  const on = locations.has(l.id);
                  const value = [
                    l.power != null && `${l.power > 0 ? "+" : ""}${l.power}勢`,
                    l.prestige != null && `${l.prestige > 0 ? "+" : ""}${l.prestige}威`,
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <label
                      key={l.id}
                      className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1.5 text-xs transition-colors ${
                        on ? "border-jade bg-jade/12 text-jade-soft" : "border-line text-paper/80"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setLocations((prev) => {
                            const next = new Set(prev);
                            if (next.has(l.id)) next.delete(l.id);
                            else next.add(l.id);
                            return next;
                          })
                        }
                        className="h-3.5 w-3.5 shrink-0 accent-jade"
                      />
                      {stage?.hasLocations ? (
                        <span className="tabular shrink-0 text-muted/60">{i + 1}</span>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate">{l.label}</span>
                      {value ? (
                        <span className="tabular shrink-0 text-[10px] text-muted/70">{value}</span>
                      ) : null}
                    </label>
                  );
                })}
              </div>

              {picked.length > 0 ? (
                <div className="mt-2 space-y-1.5">
                  {presetPower !== 0 || presetPrestige !== 0 ? (
                    <Button
                      size="sm"
                      variant="jade"
                      className="w-full"
                      disabled={busy}
                      onClick={applyPresets}
                    >
                      套用給已選的 {selected.size} 位玩家
                    </Button>
                  ) : null}
                  {hasManual ? (
                    <p className="text-[11px] leading-relaxed text-muted/70">
                      勾選項目中有數值不固定的，請用下方按鈕自行輸入金額。
                    </p>
                  ) : null}
                </div>
              ) : null}
            </Panel>
          ) : null}

          <Panel className="p-3">
            <SectionTitle
              extra={
                <span className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted">
                    已選 <b className="text-gold-soft">{selected.size}</b>/{players.length}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(players.map((p) => p.id)))}>
                    全選
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    清除
                  </Button>
                </span>
              }
            >
              玩 家
            </SectionTitle>

            {players.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm text-muted">還沒有玩家入場</p>
                <p className="mt-1.5 text-xs text-muted/70">
                  請玩家輸入場次 <b className="text-gold-soft">{code}</b> 選角
                </p>
                <p className="mt-1 text-[11px] text-muted/50">{PLAYER_COUNT_HINT}</p>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {players.map((p, i) => {
                  const on = selected.has(p.id);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => toggle(p.id)}
                        className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                          on ? "border-gold/70 bg-gold/10" : "border-line bg-panel-2/60"
                        }`}
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                            on ? "border-gold bg-gold text-ink" : "border-line text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                        <span className="tabular w-3 shrink-0 text-[11px] text-muted">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-bold text-paper">
                          {p.name}
                        </span>
                        <span className="tabular shrink-0 text-sm text-jade-soft">{p.power}</span>
                        <span className="shrink-0 text-[10px] text-muted/50">勢</span>
                        <span className="tabular shrink-0 text-sm text-gold-soft">{p.prestige}</span>
                        <span className="shrink-0 text-[10px] text-muted/50">威</span>
                        <span className="tabular shrink-0 text-sm text-vermilion-soft">{p.hp}</span>
                        <span className="shrink-0 text-[10px] text-muted/50">血</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      ) : null}

      {/* ---------- 階段 ---------- */}
      {tab === "stage" ? (
        <div className="space-y-3">
          {pendingSettlement > 0 ? (
            <Notice kind="info">
              有 {pendingSettlement} 筆舉報待結算，切換到下一階段時會自動生效。
            </Notice>
          ) : null}

          <Panel className="p-3">
            <SectionTitle>遊 戲 階 段</SectionTitle>
            <ul className="space-y-1.5">
              {STAGES.map((s) => {
                const active = session?.stageId === s.id;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => post("/stage", { stageId: s.id }, "", "切換階段失敗")}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                        active ? "border-gold bg-gold/12" : "border-line bg-panel-2/60"
                      }`}
                    >
                      <span className="tabular mr-1.5 text-[11px] text-muted/60">{s.index}</span>
                      <span className={`text-sm font-bold ${active ? "text-gold-soft" : "text-paper/85"}`}>
                        {s.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted/70">{s.hint}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel className="p-3">
            <SectionTitle
              extra={
                snapshot && snapshot.poolLeft > 0 ? (
                  <span className="text-[11px] text-muted">
                    彩池剩 <b className="text-gold-soft">{snapshot.poolLeft}</b> 張
                  </span>
                ) : null
              }
            >
              勢 力 招 募
            </SectionTitle>
            {stage?.autoRecruit ? (
              <>
                <p className="text-[11px] leading-relaxed text-muted/80">
                  本階段招募已自動開啟，不需手動操作。
                  {stage.grantsDraws
                    ? "進入本階段時已依威望排名發放抽取次數。"
                    : "本階段不發放抽取次數。"}
                </p>
                {stage.grantsDraws ? (
                  <>
                    <div className="mt-2 space-y-1">
                      {players.map((p) => (
                        <div key={p.id} className="flex items-center gap-2 text-xs">
                          <span className="min-w-0 flex-1 truncate text-paper/85">{p.name}</span>
                          <span className="tabular text-muted">威望 {p.prestige}</span>
                          <span
                            className={`tabular w-14 text-right ${
                              p.drawsRemaining > 0 ? "text-jade-soft" : "text-muted/50"
                            }`}
                          >
                            剩 {p.drawsRemaining} 次
                          </span>
                        </div>
                      ))}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-2 w-full"
                      disabled={busy}
                      onClick={() => {
                        if (
                          !confirm(
                            "重新發放本階段的招募次數並重建彩池？\n已抽到的勢力值與技能卡不會退回。",
                          )
                        )
                          return;
                        void post("/recruit", {}, "已重新發放招募次數", "重新發放失敗");
                      }}
                    >
                      重新發放招募次數
                    </Button>
                  </>
                ) : null}
              </>
            ) : (
              <p className="text-[11px] leading-relaxed text-muted/70">
                「{stage?.label}」沒有招募。招募從第一週開始自動開啟。
              </p>
            )}
          </Panel>

          <AuctionPanel
            code={code}
            pin={pin}
            players={players}
            stageId={session?.stageId ?? ""}
            onDone={refresh}
          />

          <CertificatePanel
            players={players}
            stageId={session?.stageId ?? ""}
            issued={Boolean(session?.certsIssued)}
            busy={busy}
            onIssue={() => post("/certificates", {}, "聘書已發放", "發放聘書失敗")}
          />
        </div>
      ) : null}

      {/* ---------- 舉報判定 ---------- */}
      {tab === "report" ? (
        <div className="space-y-3">
        {/* 投票進度：只顯示「還剩幾張」，票型要到紀錄分頁才看得到 */}
        {stage?.hasVote ? (
          <Panel className="p-3">
            <SectionTitle
              extra={
                snapshot?.allVotesCast ? (
                  <span className="rounded-full border border-jade/50 bg-jade/10 px-2 py-0.5 text-[11px] text-jade-soft">
                    全部投完
                  </span>
                ) : (
                  <span className="rounded-full border border-vermilion/50 bg-vermilion/10 px-2 py-0.5 text-[11px] text-vermilion-soft">
                    還有人沒投
                  </span>
                )
              }
            >
              競 選 投 票 進 度
            </SectionTitle>

            {(snapshot?.voteProgress ?? []).length === 0 ? (
              <p className="py-3 text-center text-xs text-muted/70">尚無玩家</p>
            ) : (
              <ul className="space-y-1">
                {(snapshot?.voteProgress ?? []).map((v) => (
                  <li key={v.playerId} className="flex items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate text-paper/85">{v.playerName}</span>
                    {v.totalLeft === 0 ? (
                      <span className="text-jade-soft">已投完</span>
                    ) : (
                      <>
                        <span className="tabular text-muted">
                          同意 {v.approveLeft}・不同意 {v.opposeLeft}
                        </span>
                        <span className="tabular w-14 text-right text-vermilion-soft">
                          剩 {v.totalLeft} 張
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-2 text-[11px] leading-relaxed text-muted/70">
              誰投給誰不顯示在這裡，要到「紀錄」分頁才看得到票型。
              全部投完才能切換到下一階段；結算時一張票 1 點威望，
              威望最高的人自動獲得「當選會長助理」+200 勢力
              （平票比勢力，再平比入場順序）。
              <br />
              有人臨時離場投不了的話，到「設定」分頁把他移出場次，進度就不會再等他。
            </p>
          </Panel>
        ) : null}

        <Panel className="p-3">
          <SectionTitle
            extra={
              pendingSettlement > 0 ? (
                <span className="rounded-full border border-vermilion/50 bg-vermilion/10 px-2 py-0.5 text-[11px] text-vermilion-soft">
                  {pendingSettlement} 筆待結算
                </span>
              ) : null
            }
          >
            舉 報 紀 錄
          </SectionTitle>

          {(snapshot?.reports.length ?? 0) === 0 ? (
            <p className="py-6 text-center text-xs text-muted/70">尚無舉報</p>
          ) : (
            <ul className="space-y-2">
              {snapshot?.reports.map((r) => (
                <li
                  key={r.id}
                  className={`rounded-lg border px-3 py-2 ${
                    r.settled ? "border-line bg-panel-2/50" : "border-vermilion/40 bg-vermilion/5"
                  }`}
                >
                  <p className="text-sm text-paper/90">
                    <b className="text-paper">{r.reporterName}</b>
                    <span className="text-muted"> 舉報 </span>
                    <b className="text-paper">{r.targetName}</b>
                    <span className="ml-1.5 text-xs text-muted">線索 {r.clueCode}</span>
                  </p>
                  <p className="mt-1 text-xs">
                    <span
                      className={r.verdict === "success" ? "text-jade-soft" : "text-vermilion-soft"}
                    >
                      {r.verdict === "success" ? "成立" : "不成立"}
                    </span>
                    <span className="ml-1.5 text-muted/60">
                      （扣 {r.verdict === "success" ? r.targetName : r.reporterName} 1 點威望）
                    </span>
                    <span className="ml-2 text-muted/70">
                      {r.settled ? "已生效" : "待下一階段生效"}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-muted/70">
            系統依線索卡對應表自動判定，不需主持人裁決：
            編號對應到被舉報者就成立（對方 −1 威望）；對應到其他人會當場退回不受理；
            編號不在 21 張名單中則照樣受理，但結算時扣舉報人 1 威望。
            威望值會在你切換到下一階段時一併結算，玩家端只看得到數字，看不到明細。
          </p>
        </Panel>
        </div>
      ) : null}

      {/* ---------- 設定 ---------- */}
      {tab === "setup" ? (
        <div className="space-y-3">
          <Panel className="p-3">
            <SectionTitle
              extra={
                players.some((p) => !p.faction) ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      post("/factions", {}, "已依劇本套用陣營", "套用陣營失敗")
                    }
                    className="text-[11px] text-gold underline underline-offset-4 disabled:opacity-50"
                  >
                    依劇本套用
                  </button>
                ) : null
              }
            >
              陣 營 與 隱 藏 分 支
            </SectionTitle>
            <p className="mb-2 text-[11px] leading-relaxed text-muted/70">
              陣營由劇本固定，入場時自動套用。陸秉白預設為隱藏鬼老，
              若他選擇加入其他陣營，在這裡改。
            </p>
            {players.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted/70">尚無玩家</p>
            ) : (
              <ul className="space-y-2">
                {players.map((p) => {
                  const character = CHARACTER_MAP[p.characterId];
                  // 劇本陣營由伺服器帶下來，前端不 import 機密對應表
                  const scriptFaction = snapshot?.scriptFactions?.[p.characterId] ?? "";
                  return (
                    <li key={p.id} className="rounded-lg border border-line bg-panel-2/60 px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-bold text-paper">{p.name}</span>
                        {character ? (
                          <span
                            className={`shrink-0 rounded border px-1 text-[10px] ${DIFFICULTY_STYLE[character.difficulty]}`}
                          >
                            {character.difficulty}
                          </span>
                        ) : null}
                        <span className="truncate text-[11px] text-muted/60">
                          {character?.occupation}
                        </span>
                        {/* 玩家掉線要用暱稱認回自己的角色，忘記時主持人得說得出來 */}
                        {p.nickname ? (
                          <span className="shrink-0 rounded border border-line px-1 text-[10px] text-paper/70">
                            暱稱 {p.nickname}
                          </span>
                        ) : (
                          <span className="shrink-0 text-[10px] text-vermilion-soft">未填暱稱</span>
                        )}
                        <button
                          type="button"
                          onClick={() => kick(p.id, p.name)}
                          className="ml-auto shrink-0 px-1 text-xs text-muted/50 hover:text-vermilion-soft"
                          aria-label={`移出 ${p.name}`}
                        >
                          ✕
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <select
                          value={p.faction}
                          disabled={busy}
                          onChange={(e) =>
                            post(
                              `/players/${p.id}/faction`,
                              { faction: e.target.value as Faction | "" },
                              `${p.name} 陣營已設定`,
                              "設定陣營失敗",
                            )
                          }
                          className="rounded border border-line bg-lacquer px-2 py-1 text-xs text-paper outline-none focus:border-gold/70"
                        >
                          <option value="">陣營未設定</option>
                          {FACTIONS.map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </select>
                        {scriptFaction && p.faction && p.faction !== scriptFaction ? (
                          <span className="rounded border border-gold/40 bg-gold/10 px-2 py-1 text-[10px] text-gold-soft">
                            已改動・劇本為 {scriptFaction}
                          </span>
                        ) : null}

                        {character?.hasHiddenBranch ? (
                          p.hiddenBranchLocked ? (
                            <span className="rounded border border-vermilion/40 bg-vermilion/10 px-2 py-1 text-[11px] text-vermilion-soft">
                              {p.hiddenBranch}・已鎖定
                            </span>
                          ) : (
                            HIDDEN_BRANCHES.map((b) => (
                              <Button
                                key={b}
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => {
                                  if (!confirm(`將 ${p.name} 的隱藏分支鎖定為「${b}」？設定後不可更改。`))
                                    return;
                                  void post(
                                    `/players/${p.id}/branch`,
                                    { branch: b },
                                    `${p.name} 隱藏分支鎖定為「${b}」`,
                                    "設定隱藏分支失敗",
                                  );
                                }}
                              >
                                {b}
                              </Button>
                            ))
                          )
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel className="p-3">
            <SectionTitle>場 次 控 制</SectionTitle>
            <div className="grid grid-cols-3 gap-2">
              {(["open", "paused", "closed"] as const).map((st) => (
                <Button
                  key={st}
                  size="sm"
                  variant={st === "closed" ? "danger" : "ghost"}
                  disabled={busy || session?.status === st}
                  onClick={() => {
                    if (
                      st === "closed" &&
                      !confirm(
                        "確定要結束本場次嗎？\n\n" +
                          `結束後會把這一場的資料彙整成試算表裡的「${code}」分頁，` +
                          "並刪掉玩家／紀錄／舉報三個工作分頁。\n" +
                          "封存後就不能再進場或調配數值了。",
                      )
                    )
                      return;
                    void post("/status", { status: st }, "", "更新場次狀態失敗");
                  }}
                >
                  {st === "open" ? "開放" : st === "paused" ? "暫停" : "結束"}
                </Button>
              ))}
            </div>
            <p className="mt-2.5 text-[11px] leading-relaxed text-muted/70">
              玩家入場：首頁 →「我是玩家」→ 輸入你設定的<b className="text-gold-soft">開場密碼</b>
              <br />
              結束場次時會自動把資料彙整成「
              <b className="text-gold-soft">{code}</b>」這個分頁，並清掉工作分頁。
            </p>
            <Link
              href={`/player/${code}`}
              target="_blank"
              className="mt-1.5 inline-block text-[11px] text-muted underline underline-offset-4 hover:text-gold"
            >
              以玩家視角預覽 ↗
            </Link>
          </Panel>
        </div>
      ) : null}

      {/* ---------- 紀錄 ---------- */}
      {tab === "log" ? (
        <Panel className="p-3">
          <SectionTitle>最 新 紀 錄</SectionTitle>
          <LogFeed log={snapshot?.log ?? []} showSource />
        </Panel>
      ) : null}
    </AppShell>
  );
}

/**
 * 會長就任聘書。
 *
 * 依規則，第 1 名與第 2 名勢力值同分時不可自動判定會長，所以這裡先把名次與稱號
 * 攤開讓主持人核對；同分或有人沒填暱稱時直接擋下來，不讓他按到後端才報錯。
 */
function CertificatePanel({
  players,
  stageId,
  issued,
  busy,
  onIssue,
}: {
  players: Player[];
  stageId: string;
  issued: boolean;
  busy: boolean;
  onIssue: () => void;
}) {
  const isFinal = stageId === "final";
  const ordered = [...players].sort(
    (a, b) => b.power - a.power || a.joinedAt.localeCompare(b.joinedAt),
  );
  const missing = ordered.filter((p) => !p.nickname.trim());
  const tie = ordered.length >= 2 && ordered[0].power === ordered[1].power;
  const blocker = tie
    ? `${ordered[0].name} 與 ${ordered[1].name} 勢力值同為 ${ordered[0].power}，請先調整再發放`
    : missing.length > 0
      ? `${missing.map((p) => p.name).join("、")} 沒有填暱稱，聘書無法署名`
      : ordered.length === 0
        ? "場上沒有玩家"
        : "";

  return (
    <Panel className="p-3">
      <SectionTitle
        extra={issued ? <span className="text-[11px] text-jade-soft">已發放</span> : null}
      >
        會 長 就 任 聘 書
      </SectionTitle>

      {!isFinal ? (
        <p className="text-[11px] leading-relaxed text-muted/70">
          聘書在「會長就任結算」階段發放。切換到該階段後就能在這裡按鈕發出。
        </p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {ordered.map((p, i) => (
              <li key={p.id} className="flex gap-2 text-xs">
                <span className="tabular w-4 shrink-0 pt-px text-right text-muted/60">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="min-w-0 truncate">
                      <span className="text-paper/85">{p.nickname.trim() || p.name}</span>
                      {p.nickname.trim() ? (
                        <span className="ml-1 text-[10px] text-muted/60">{p.name}</span>
                      ) : (
                        <span className="ml-1 text-[10px] text-vermilion-soft">缺暱稱</span>
                      )}
                    </span>
                    <span className="tabular ml-auto shrink-0 text-muted">{p.power}</span>
                  </span>
                  {/* 稱號放第二行，7 個稱號長短差很多，擠在同一行一定被截掉 */}
                  <span className="block text-[11px] leading-snug text-gold-soft">
                    {positionForRank(i + 1)}・{titleForRank(i + 1)}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          {blocker ? <p className="mt-2 text-[11px] text-vermilion-soft">{blocker}</p> : null}

          <Button
            variant="primary"
            className="mt-2 w-full"
            disabled={busy || Boolean(blocker)}
            onClick={() => {
              if (
                !confirm(
                  issued
                    ? "重新發放聘書？會依目前的勢力值排名覆蓋原本的名次。"
                    : `依目前勢力值排名發放聘書給 ${ordered.length} 名玩家？`,
                )
              )
                return;
              onIssue();
            }}
          >
            {issued ? "重新發放聘書" : "發放聘書"}
          </Button>
          <p className="mt-2 text-[11px] leading-relaxed text-muted/70">
            發放後玩家在「我的」分頁就會看到自己的聘書。
          </p>
        </>
      )}
    </Panel>
  );
}
/**
 * 拍賣結算。
 *
 * 現場喊價，主持人在這裡輸入誰得標、付了多少；系統先扣出價再入帳標的的真實
 * 價值，賺賠一次算清。價值是劇本固定的，所以主持人只要填出價就好——
 * 南洋花滿樓例外，它的價值不固定，要一起填。
 */
function AuctionPanel({
  code,
  pin,
  players,
  stageId,
  onDone,
}: {
  code: string;
  pin: string;
  players: Player[];
  stageId: string;
  onDone: () => Promise<unknown>;
}) {
  const stage = STAGE_MAP[stageId];
  const [lotId, setLotId] = useState(AUCTION_LOTS[0].id);
  const [playerId, setPlayerId] = useState("");
  const [paid, setPaid] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const lot = AUCTION_LOT_MAP[lotId];
  const needsValue = lot?.value === null;

  async function submit() {
    setError(null);
    setResult(null);
    if (!playerId) return setError("請選擇得標的玩家");
    if (!paid.trim()) return setError("請輸入得標者付了多少勢力值");

    setBusy(true);
    try {
      const r = await api<{
        lotLabel: string;
        paid: number;
        value: number;
        net: number;
        balance: number;
      }>(`/api/sessions/${code}/auction`, {
        method: "POST",
        hostPin: pin,
        body: JSON.stringify({
          playerId,
          lotId,
          paid: Number(paid),
          value: needsValue ? Number(value) : undefined,
        }),
      });
      const name = players.find((p) => p.id === playerId)?.name ?? "得標者";
      setResult(
        `${name} 拍得「${r.lotLabel}」：付出 ${r.paid}，價值 ${r.value}，` +
          `${r.net >= 0 ? `賺 ${r.net}` : `賠 ${-r.net}`}，餘額 ${r.balance}。`,
      );
      setPaid("");
      setValue("");
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "拍賣結算失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="p-3">
      <SectionTitle>拍 賣 結 算</SectionTitle>

      {!stage?.hasAuction ? (
        <p className="text-[11px] leading-relaxed text-muted/70">
          拍賣在「第三週：拍賣」進行。切到該階段後就能在這裡結算。
        </p>
      ) : (
        <div className="space-y-2">
          {error ? <Notice>{error}</Notice> : null}
          {result ? <Notice kind="success">{result}</Notice> : null}

          <select
            value={lotId}
            onChange={(e) => {
              setLotId(e.target.value);
              setResult(null);
            }}
            className="w-full rounded border border-line bg-lacquer px-2 py-2 text-sm text-paper outline-none focus:border-gold/70"
          >
            {AUCTION_LOTS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
                {l.value === null ? "（價值現場決定）" : `（價值 ${l.value}）`}
              </option>
            ))}
          </select>

          <select
            value={playerId}
            onChange={(e) => setPlayerId(e.target.value)}
            className="w-full rounded border border-line bg-lacquer px-2 py-2 text-sm text-paper outline-none focus:border-gold/70"
          >
            <option value="">選擇得標的玩家…</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（勢力 {p.power}）
              </option>
            ))}
          </select>

          <div className="flex gap-1.5">
            <input
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
              placeholder="得標價"
              inputMode="numeric"
              className="min-w-0 flex-1 rounded border border-line bg-lacquer px-2 py-2 text-sm text-paper outline-none focus:border-gold/70"
            />
            {needsValue ? (
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="真實價值"
                inputMode="numeric"
                className="min-w-0 flex-1 rounded border border-line bg-lacquer px-2 py-2 text-sm text-paper outline-none focus:border-gold/70"
              />
            ) : null}
            <Button disabled={busy} onClick={submit}>
              結算
            </Button>
          </div>

          <p className="text-[11px] leading-relaxed text-muted/70">
            送出後先扣得標價，再入帳標的的真實價值，差額就是這一標的賺賠。
            玩家只看得到自己的那兩筆。
          </p>
        </div>
      )}
    </Panel>
  );
}
