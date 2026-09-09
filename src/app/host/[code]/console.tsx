"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LogFeed } from "@/components/log-feed";
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
import {
  CHARACTER_MAP,
  DIFFICULTY_STYLE,
  FACTIONS,
  HIDDEN_BRANCHES,
  type Faction,
} from "@/lib/characters";
import {
  EXPO_LOCATIONS,
  EXPO_PICK_COUNT,
  LEDGER_SOURCES,
  PLAYER_COUNT_HINT,
  RESOURCES,
  STAGES,
  STAGE_MAP,
  type LedgerSource,
} from "@/lib/config";
import { ApiError, api, clearHostPin, loadHostPin, saveHostPin } from "@/lib/client";
import { rankByPower, useHostState } from "@/lib/use-session-state";
import type { ResourceKey } from "@/lib/types";

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
      await api(`/api/sessions/${code}/verify-host`, {
        method: "POST",
        hostPin: value.trim(),
      });
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
          場次 <CodeStamp code={code} /> 需要主持通行碼才能進入。
        </p>
      </header>
      <Panel>
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="主持通行碼"
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
  const quickDeltas = stage?.quickDeltas ?? [1, 5, 10, 50, 100];
  const pendingReports = (snapshot?.reports ?? []).filter((r) => r.verdict === "");
  /** 已判定但還沒生效的，會在下次開啟招募時扣威望 */
  const pendingSettlement = (snapshot?.reports ?? []).filter(
    (r) => r.verdict !== "" && !r.settled,
  ).length;

  /** 拓展會：勾選的地點會寫進事由，有設定分數時自動加總 */
  const pickedLocations = EXPO_LOCATIONS.filter((l) => locations.has(l.id));
  const locationSum = pickedLocations.every((l) => l.power !== null)
    ? pickedLocations.reduce((sum, l) => sum + (l.power ?? 0), 0)
    : null;

  useEffect(() => {
    setSelected((prev) => {
      const alive = new Set(players.map((p) => p.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [players]);

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

  const flash = useCallback((kind: "success" | "error", text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 2800);
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
      flash("error", "請先點選要調配的玩家，或按「全體」");
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
          reason: pickedLocations.length
            ? `${pickedLocations.map((l) => l.name).join("、")}${reason ? `（${reason}）` : ""}`
            : reason,
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
      <PageShell wide>
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

  return (
    <PageShell wide>
      <div className="flex items-center justify-between gap-3">
        <BackLink href="/" label="回身分選擇" />
        <span className="text-xs text-muted/60">每 2.5 秒自動更新</span>
      </div>

      <header className="mt-4 mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-paper">{session?.title}</h1>
        <CodeStamp code={code} />
        {session ? <StatusPill status={session.status} /> : null}
        <span className="text-sm text-gold-soft">
          {stage ? `第 ${stage.index} 階段・${stage.label}` : session?.stageId}
        </span>
        {session?.recruitOpen ? (
          <span className="rounded-full border border-jade/50 bg-jade/10 px-2.5 py-0.5 text-xs text-jade-soft">
            招募開放中
          </span>
        ) : null}
      </header>

      {toast ? (
        <div className="mb-4">
          <Notice kind={toast.kind === "success" ? "success" : "error"}>{toast.text}</Notice>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {/* ---- 資源調配 ---- */}
          <Panel>
            <PanelTitle
              extra={
                <span className="text-xs text-muted">
                  已選 <b className="text-gold-soft">{selected.size}</b> / {players.length} 人
                </span>
              }
            >
              調 配 數 值
            </PanelTitle>

            <div className="mb-3 flex gap-2">
              {RESOURCES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setResource(r.key)}
                  className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-bold transition-colors ${
                    resource === r.key
                      ? r.key === "prestige"
                        ? "border-gold bg-gold/15 text-gold-soft"
                        : r.key === "power"
                          ? "border-jade bg-jade/15 text-jade-soft"
                          : "border-vermilion bg-vermilion/15 text-vermilion-soft"
                      : "border-line bg-panel-2 text-muted hover:text-paper"
                  }`}
                >
                  {r.label}
                  <span className="ml-1.5 text-[10px] font-normal opacity-70">
                    {r.visibility === "public" ? "公開" : "僅本人"}
                  </span>
                </button>
              ))}
            </div>

            {stage?.hasLocations ? (
              <div className="mb-3 rounded-lg border border-line bg-lacquer/60 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs tracking-widest text-gold/80">
                    地點（{EXPO_PICK_COUNT} 選）
                  </span>
                  <span className="text-xs text-muted">
                    已勾 <b className="text-gold-soft">{pickedLocations.length}</b>
                    {locationSum !== null ? (
                      <span className="ml-2 text-jade-soft">合計 {locationSum}</span>
                    ) : (
                      <span className="ml-2 text-muted/60">分數未設定，請自行輸入</span>
                    )}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {EXPO_LOCATIONS.map((l, i) => {
                    const on = locations.has(l.id);
                    return (
                      <label
                        key={l.id}
                        className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-xs transition-colors ${
                          on ? "border-jade bg-jade/12 text-jade-soft" : "border-line text-paper/80 hover:border-jade/50"
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
                          className="h-3.5 w-3.5 accent-jade"
                        />
                        <span className="tabular text-muted/60">{i + 1}</span>
                        {l.name}
                      </label>
                    );
                  })}
                </div>
                {pickedLocations.length > 0 ? (
                  <p className="mt-2 text-xs text-muted/70">
                    送出時會把「{pickedLocations.map((l) => l.name).join("、")}」寫進紀錄事由
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="mb-3 grid gap-2 sm:grid-cols-[190px_1fr]">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as LedgerSource)}
                className="rounded-lg border border-line bg-lacquer px-3 py-2.5 text-sm text-paper outline-none focus:border-gold/70"
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
                placeholder="事由（選填，會寫進紀錄）"
                className="min-w-0 rounded-lg border border-line bg-lacquer px-3 py-2.5 text-sm text-paper outline-none placeholder:text-muted/45 focus:border-gold/70"
              />
            </div>

            <div className={`grid gap-2 ${quickDeltas.length === 3 ? "grid-cols-3" : quickDeltas.length === 4 ? "grid-cols-4" : "grid-cols-5"}`}>
              {quickDeltas.map((d) => (
                <Button key={`p${d}`} size="sm" variant="jade" disabled={busy} onClick={() => grant(d)} className="py-2.5">
                  +{d}
                </Button>
              ))}
              {quickDeltas.map((d) => (
                <Button key={`m${d}`} size="sm" variant="danger" disabled={busy} onClick={() => grant(-d)} className="py-2.5">
                  −{d}
                </Button>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="自訂數值（可填負數）"
                inputMode="numeric"
                className="tabular min-w-0 flex-1 rounded-lg border border-line bg-lacquer px-3 py-2.5 text-sm text-paper outline-none placeholder:text-muted/45 focus:border-gold/70"
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
                className="shrink-0 px-4"
              >
                送出
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || players.length === 0}
                onClick={() => {
                  const n = Number(custom || "0");
                  if (!Number.isFinite(n) || n === 0) return flash("error", "全體發放請先填自訂數值");
                  void grant(n, true);
                }}
                className="shrink-0 px-4"
              >
                全體
              </Button>
            </div>
          </Panel>

          {/* ---- 玩家列表 ---- */}
          <Panel>
            <PanelTitle
              extra={
                <span className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(players.map((p) => p.id)))}>
                    全選
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    清除
                  </Button>
                </span>
              }
            >
              在 場 玩 家
            </PanelTitle>

            {players.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-muted">還沒有玩家入場</p>
                <p className="mt-2 text-xs text-muted/70">
                  請玩家開啟本站 →「我是玩家」→ 輸入場次{" "}
                  <b className="text-gold-soft">{code}</b> → 選角
                </p>
                <p className="mt-1 text-xs text-muted/50">{PLAYER_COUNT_HINT}</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {players.map((p, i) => {
                  const on = selected.has(p.id);
                  const character = CHARACTER_MAP[p.characterId];
                  const toggle = () =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(p.id)) next.delete(p.id);
                      else next.add(p.id);
                      return next;
                    });

                  return (
                    <li
                      key={p.id}
                      className={`rounded-lg border px-3 py-2.5 transition-colors ${
                        on ? "border-gold/70 bg-gold/10" : "border-line bg-panel-2/60"
                      }`}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={toggle}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggle();
                          }
                        }}
                        className="flex cursor-pointer items-center gap-3"
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] ${
                            on ? "border-gold bg-gold text-ink" : "border-line text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                        <span className="tabular w-5 shrink-0 text-xs text-muted">{i + 1}</span>
                        <span className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span className="truncate text-sm font-bold text-paper">{p.name}</span>
                          {character ? (
                            <>
                              <span
                                className={`shrink-0 rounded border px-1 text-[10px] font-normal ${DIFFICULTY_STYLE[character.difficulty]}`}
                              >
                                {character.difficulty}
                              </span>
                              <span className="hidden shrink-0 text-[10px] text-muted/60 sm:inline">
                                {character.occupation}
                              </span>
                            </>
                          ) : null}
                        </span>
                        <span className="tabular shrink-0 text-sm text-jade-soft">{p.power}</span>
                        <span className="shrink-0 text-xs text-muted/50">勢</span>
                        <span className="tabular shrink-0 text-sm text-gold-soft">{p.prestige}</span>
                        <span className="shrink-0 text-xs text-muted/50">威</span>
                        <span className="tabular shrink-0 text-sm text-vermilion-soft">{p.hp}</span>
                        <span className="shrink-0 text-xs text-muted/50">血</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void kick(p.id, p.name);
                          }}
                          className="shrink-0 px-1 text-xs text-muted/50 transition-colors hover:text-vermilion-soft"
                          aria-label={`移出 ${p.name}`}
                        >
                          ✕
                        </button>
                      </div>

                      {/* 機密設定：陣營與隱藏分支，只有主持人看得到 */}
                      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line/50 pt-2">
                        <span className="text-[10px] tracking-widest text-muted/60">陣營</span>
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
                          <option value="">未設定</option>
                          {FACTIONS.map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </select>

                        {character?.hasHiddenBranch ? (
                          <>
                            <span className="ml-2 text-[10px] tracking-widest text-muted/60">
                              隱藏分支
                            </span>
                            {p.hiddenBranchLocked ? (
                              <span className="rounded border border-vermilion/40 bg-vermilion/10 px-2 py-1 text-xs text-vermilion-soft">
                                {p.hiddenBranch}（已鎖定，不可更改）
                              </span>
                            ) : (
                              HIDDEN_BRANCHES.map((b) => (
                                <Button
                                  key={b}
                                  size="sm"
                                  variant="ghost"
                                  disabled={busy}
                                  onClick={() => {
                                    if (
                                      !confirm(
                                        `將 ${p.name} 的隱藏分支鎖定為「${b}」？依規則設定後不可更改。`,
                                      )
                                    )
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
                            )}
                          </>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        {/* ---- 右欄 ---- */}
        <div className="space-y-4">
          <Panel>
            <PanelTitle>遊 戲 階 段</PanelTitle>
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
                        active ? "border-gold bg-gold/12" : "border-line bg-panel-2/60 hover:border-gold/50"
                      }`}
                    >
                      <span className="tabular mr-1.5 text-xs text-muted/60">{s.index}</span>
                      <span className={`text-sm font-bold ${active ? "text-gold-soft" : "text-paper/85"}`}>
                        {s.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted/70">{s.hint}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel>
            <PanelTitle>勢 力 招 募</PanelTitle>
            {stage?.hasRecruit ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="jade"
                    disabled={busy || session?.recruitOpen}
                    onClick={() => post("/recruit", { open: true }, "招募已開啟", "開啟招募失敗")}
                  >
                    開啟招募
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !session?.recruitOpen}
                    onClick={() => post("/recruit", { open: false }, "招募已鎖定", "鎖定招募失敗")}
                  >
                    鎖定招募
                  </Button>
                </div>
                <p className="mt-2.5 text-xs leading-relaxed text-muted/70">
                  目前狀態：
                  {session?.recruitOpen ? (
                    <b className="text-jade-soft">開放中</b>
                  ) : (
                    <b className="text-muted">已鎖定</b>
                  )}
                  {pendingSettlement > 0 ? (
                    <span className="mt-1 block text-vermilion-soft">
                      開啟招募時會一併結算 {pendingSettlement} 筆已判定的舉報
                    </span>
                  ) : null}
                </p>
              </>
            ) : (
              <p className="text-xs leading-relaxed text-muted/70">
                「{stage?.label}」沒有勢力招募。招募只在第一～三週開放。
              </p>
            )}
          </Panel>

          {stage?.hasReport || (snapshot?.reports.length ?? 0) > 0 ? (
            <Panel>
              <PanelTitle
                extra={
                  pendingReports.length > 0 ? (
                    <span className="rounded-full border border-vermilion/50 bg-vermilion/10 px-2 py-0.5 text-xs text-vermilion-soft">
                      {pendingReports.length} 筆待判定
                    </span>
                  ) : null
                }
              >
                舉 報 判 定
              </PanelTitle>

              {(snapshot?.reports.length ?? 0) === 0 ? (
                <p className="py-4 text-center text-xs text-muted/70">尚無舉報</p>
              ) : (
                <ul className="max-h-72 space-y-2 overflow-y-auto">
                  {snapshot?.reports.map((r) => (
                    <li
                      key={r.id}
                      className={`rounded-lg border px-3 py-2 ${
                        r.verdict === "" ? "border-vermilion/40 bg-vermilion/5" : "border-line bg-panel-2/50"
                      }`}
                    >
                      <p className="text-sm text-paper/90">
                        <b className="text-paper">{r.reporterName}</b>
                        <span className="text-muted"> 舉報 </span>
                        <b className="text-paper">{r.targetName}</b>
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        線索卡 <b className="text-gold-soft">{r.clueCode}</b>
                      </p>
                      {r.verdict === "" ? (
                        <div className="mt-2 flex gap-2">
                          <Button
                            size="sm"
                            variant="jade"
                            disabled={busy}
                            onClick={() =>
                              post(`/reports/${r.id}`, { verdict: "success" }, "已判定成立", "判定失敗")
                            }
                          >
                            成立
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={busy}
                            onClick={() =>
                              post(`/reports/${r.id}`, { verdict: "fail" }, "已判定不成立", "判定失敗")
                            }
                          >
                            不成立
                          </Button>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs">
                          <span
                            className={r.verdict === "success" ? "text-jade-soft" : "text-vermilion-soft"}
                          >
                            {r.verdict === "success" ? "成立" : "不成立"}
                          </span>
                          <span className="ml-2 text-muted/70">
                            {r.settled ? "已生效" : "待下次開啟招募時生效"}
                          </span>
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {pendingReports.length > 0 ? (
                <p className="mt-2.5 text-xs leading-relaxed text-muted/70">
                  判定後威望值不會立刻變動，會在下一次「開啟招募」時一併結算。
                </p>
              ) : null}
            </Panel>
          ) : null}

          <Panel>
            <PanelTitle>場 次 控 制</PanelTitle>
            <div className="grid grid-cols-3 gap-2">
              {(["open", "paused", "closed"] as const).map((st) => (
                <Button
                  key={st}
                  size="sm"
                  variant={st === "closed" ? "danger" : "ghost"}
                  disabled={busy || session?.status === st}
                  onClick={() => {
                    if (st === "closed" && !confirm("確定要結束本場次嗎？結束後就不能再調配數值。"))
                      return;
                    void post("/status", { status: st }, "", "更新場次狀態失敗");
                  }}
                >
                  {st === "open" ? "開放" : st === "paused" ? "暫停" : "結束"}
                </Button>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted/70">
              玩家入場：本站首頁 →「我是玩家」→ 輸入 <b className="text-gold-soft">{code}</b>
            </p>
            <Link
              href={`/player/${code}`}
              target="_blank"
              className="mt-2 inline-block text-xs text-muted underline underline-offset-4 transition-colors hover:text-gold"
            >
              以玩家視角預覽 ↗
            </Link>
          </Panel>

          <Panel>
            <PanelTitle>最 新 紀 錄</PanelTitle>
            <div className="max-h-96 overflow-y-auto">
              <LogFeed log={snapshot?.log ?? []} showSource />
            </div>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
