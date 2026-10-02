"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { BackLink, Button, Field, Notice, PageShell, Panel, PanelTitle } from "@/components/ui";
import { ApiError, onlineApi, saveHostPin } from "@/lib/online/client";
import { codeForDate, parseDateKey, todayKey } from "@/lib/online/date-code";
import { ONLINE_META } from "@/lib/online/meta";
import { DateCodeField } from "../date-field";
import type { OnlineScriptId } from "@/lib/online/types";

/** 主持人入口：開新場次（場次就是當天日期），或用日期＋密碼回到進行中的場次 */
export function HostEntry() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get("script");
  const [script, setScript] = useState<OnlineScriptId>(initial === "fengtuz" ? "fengtuz" : "tiancai");
  const [pin, setPin] = useState("");
  const [date, setDate] = useState(todayKey());
  const [resumeDate, setResumeDate] = useState(todayKey());
  const [resumePin, setResumePin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const meta = ONLINE_META[script];

  async function create() {
    if (date.length !== 8 || !parseDateKey(date)) {
      setError("場次號碼是 8 位數字的日期，例如 20261001");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await onlineApi<{ code: string }>("", {
        method: "POST",
        body: JSON.stringify({ script, pin, date }),
      });
      saveHostPin(r.code, pin);
      router.push(`/online/host/${r.code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "開場失敗");
      setBusy(false);
    }
  }

  async function resume() {
    const key = resumeDate.length === 8 ? parseDateKey(resumeDate) : null;
    if (!key) {
      setError("場次號碼是 8 位數字的日期，例如 20261001");
      return;
    }
    const c = codeForDate(meta.prefix, key);
    setBusy(true);
    setError("");
    try {
      await onlineApi(`/${c}/state`, { pin: resumePin });
      saveHostPin(c, resumePin);
      router.push(`/online/host/${c}`);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "SESSION_NOT_FOUND"
          ? `${resumeDate} 沒有開《${meta.title}》的場次`
          : err instanceof ApiError
            ? err.message
            : "無法進入場次",
      );
      setBusy(false);
    }
  }

  return (
    <div className={meta.theme}>
      <PageShell>
        <BackLink href="/" label="回首頁" />
        <h1 className="mt-4 text-2xl font-bold text-gold-soft">主持人開場</h1>

        <div className="mt-5 grid grid-cols-2 gap-2">
          {(Object.keys(ONLINE_META) as OnlineScriptId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setScript(id)}
              className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                id === script ? "border-gold bg-gold/10 text-gold-soft" : "border-line bg-panel-2 text-muted"
              }`}
            >
              <span className="block font-bold">{ONLINE_META[id].title}</span>
              <span className="text-xs">{ONLINE_META[id].players}</span>
            </button>
          ))}
        </div>

        {error ? (
          <div className="mt-4">
            <Notice>{error}</Notice>
          </div>
        ) : null}

        <Panel className="mt-5">
          <PanelTitle>開新場次</PanelTitle>
          <div className="space-y-3">
            <DateCodeField value={date} onChange={setDate} />
            <Field
              label="主持密碼"
              hint="自己設一組（至少 4 個字），換裝置回到主持台時要用。不用告訴玩家。"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoComplete="off"
            />
            <Button className="w-full" disabled={busy || date.length !== 8 || pin.trim().length < 4} onClick={create}>
              開啟《{meta.title}》場次
            </Button>
          </div>
        </Panel>

        <Panel className="mt-4">
          <PanelTitle>回到進行中的場次</PanelTitle>
          <div className="space-y-3">
            <DateCodeField value={resumeDate} onChange={setResumeDate} />
            <Field
              label="主持密碼"
              value={resumePin}
              onChange={(e) => setResumePin(e.target.value)}
              autoComplete="off"
            />
            <Button variant="ghost" className="w-full" disabled={busy || resumeDate.length !== 8 || !resumePin} onClick={resume}>
              回到主持台
            </Button>
          </div>
        </Panel>
      </PageShell>
    </div>
  );
}
