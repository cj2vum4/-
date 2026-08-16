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
import { QUICK_DELTAS, RESOURCES, STAGES, STAGE_MAP } from "@/lib/config";
import { ApiError, api, clearHostPin, loadHostPin, saveHostPin } from "@/lib/client";
import { rankPlayers, useSessionState } from "@/lib/use-session-state";
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

  if (pin === "") {
    return <PinGate code={code} onPass={setPin} />;
  }

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
  const { snapshot, error, loading, refresh } = useSessionState(code, { intervalMs: 2500 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resource, setResource] = useState<ResourceKey>("prestige");
  const [reason, setReason] = useState("");
  const [custom, setCustom] = useState("");
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const players = useMemo(() => rankPlayers(snapshot?.players ?? []), [snapshot]);
  const session = snapshot?.session;
  const stage = session ? STAGE_MAP[session.stageId] : undefined;
  const resourceDef = RESOURCES.find((r) => r.key === resource)!;

  // 玩家離場後，把已被移除的 id 從選取清單清掉
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
          reason,
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

  async function jumpStage(stageId: string) {
    setBusy(true);
    try {
      await api(`/api/sessions/${code}/stage`, {
        method: "POST",
        hostPin: pin,
        body: JSON.stringify({ stageId }),
      });
      await refresh();
    } catch (err) {
      handleError(err, "切換階段失敗");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status: "open" | "paused" | "closed") {
    if (status === "closed" && !confirm("確定要結束本場次嗎？結束後就不能再調配資源。")) return;
    setBusy(true);
    try {
      await api(`/api/sessions/${code}/status`, {
        method: "POST",
        hostPin: pin,
        body: JSON.stringify({ status }),
      });
      await refresh();
    } catch (err) {
      handleError(err, "更新場次狀態失敗");
    } finally {
      setBusy(false);
    }
  }

  async function kick(playerId: string, name: string) {
    if (!confirm(`確定把「${name}」移出場次嗎？`)) return;
    try {
      await api(`/api/sessions/${code}/players/${playerId}`, {
        method: "DELETE",
        hostPin: pin,
      });
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
        <span className="text-sm text-gold-soft">{stage?.label}</span>
      </header>

      {toast ? (
        <div className="mb-4">
          <Notice kind={toast.kind === "success" ? "success" : "error"}>{toast.text}</Notice>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
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
              調 配 資 源
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
                        : "border-jade bg-jade/15 text-jade-soft"
                      : "border-line bg-panel-2 text-muted hover:text-paper"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="事由（選填，會寫進紀錄）例：完成第一關任務"
              className="mb-3 w-full rounded-lg border border-line bg-lacquer px-3 py-2.5 text-sm text-paper outline-none placeholder:text-muted/45 focus:border-gold/70"
            />

            <div className="grid grid-cols-5 gap-2">
              {QUICK_DELTAS.map((d) => (
                <Button
                  key={`plus-${d}`}
                  size="sm"
                  variant="jade"
                  disabled={busy}
                  onClick={() => grant(d)}
                  className="py-2.5"
                >
                  +{d}
                </Button>
              ))}
              {QUICK_DELTAS.map((d) => (
                <Button
                  key={`minus-${d}`}
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() => grant(-d)}
                  className="py-2.5"
                >
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
                  if (!Number.isFinite(n) || n === 0) {
                    flash("error", "請輸入不為零的數字");
                    return;
                  }
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
                  if (!Number.isFinite(n) || n === 0) {
                    flash("error", "全體發放請先填自訂數值");
                    return;
                  }
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
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelected(new Set(players.map((p) => p.id)))}
                  >
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
                  請玩家開啟本站 →「我是玩家」→ 輸入場次 <b className="text-gold-soft">{code}</b>
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {players.map((p, i) => {
                  const on = selected.has(p.id);
                  return (
                    <li key={p.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            next.has(p.id) ? next.delete(p.id) : next.add(p.id);
                            return next;
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelected((prev) => {
                              const next = new Set(prev);
                              next.has(p.id) ? next.delete(p.id) : next.add(p.id);
                              return next;
                            });
                          }
                        }}
                        className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                          on
                            ? "border-gold/70 bg-gold/10"
                            : "border-line bg-panel-2/60 hover:border-line/80"
                        }`}
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] ${
                            on ? "border-gold bg-gold text-ink" : "border-line text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                        <span className="tabular w-6 shrink-0 text-xs text-muted">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-bold text-paper">
                          {p.name}
                        </span>
                        <span className="tabular shrink-0 text-sm text-gold-soft">
                          {p.prestige}
                        </span>
                        <span className="shrink-0 text-xs text-muted/50">威</span>
                        <span className="tabular shrink-0 text-sm text-jade-soft">
                          {p.influence}
                        </span>
                        <span className="shrink-0 text-xs text-muted/50">勢</span>
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
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        {/* ---- 右欄：階段 / 場次 / 紀錄 ---- */}
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
                      onClick={() => jumpStage(s.id)}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                        active
                          ? "border-gold bg-gold/12"
                          : "border-line bg-panel-2/60 hover:border-gold/50"
                      }`}
                    >
                      <span
                        className={`text-sm font-bold ${active ? "text-gold-soft" : "text-paper/85"}`}
                      >
                        {s.label}
                      </span>
                      <span className="ml-2 text-xs text-muted/70">{s.hint}</span>
                      {s.allowJoin ? (
                        <span className="ml-2 text-[10px] text-jade-soft">可入場</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel>
            <PanelTitle>場 次 控 制</PanelTitle>
            <div className="grid grid-cols-3 gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || session?.status === "open"}
                onClick={() => changeStatus("open")}
              >
                開放
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || session?.status === "paused"}
                onClick={() => changeStatus("paused")}
              >
                暫停
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={busy || session?.status === "closed"}
                onClick={() => changeStatus("closed")}
              >
                結束
              </Button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted/70">
              玩家入場網址：本站首頁 →「我是玩家」→ 輸入{" "}
              <b className="text-gold-soft">{code}</b>
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
              <LogFeed log={snapshot?.log ?? []} />
            </div>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
