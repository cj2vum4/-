"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api, saveHostPin } from "@/lib/client";
import { normalizeSessionCode, todayCode } from "@/lib/date";
import { BackLink, Button, Field, Notice, PageShell, Panel } from "@/components/ui";

export default function HostEntryPage() {
  const router = useRouter();
  const [date, setDate] = useState(todayCode());
  const [title, setTitle] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const code = normalizeSessionCode(date);
    if (!code) {
      setError("日期格式無法辨識，請用 2026-08-16 這種寫法");
      return;
    }
    if (pin.trim().length < 4) {
      setError("主持通行碼至少 4 個字");
      return;
    }

    setBusy(true);
    try {
      await api(`/api/sessions`, {
        method: "POST",
        body: JSON.stringify({ date: code, title, hostPin: pin.trim() }),
      });
      saveHostPin(code, pin.trim());
      router.push(`/host/${code}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "SESSION_EXISTS") {
        // 場次已存在：改走驗證流程，讓主持人用同一顆按鈕回到主持台
        try {
          await api(`/api/sessions/${code}/verify-host`, {
            method: "POST",
            hostPin: pin.trim(),
          });
          saveHostPin(code, pin.trim());
          setInfo("此場次已開啟，正在回到主持台…");
          router.push(`/host/${code}`);
          return;
        } catch (verifyErr) {
          setError(
            verifyErr instanceof ApiError && verifyErr.code === "UNAUTHORIZED"
              ? "這個場次已經開過了，但通行碼不正確"
              : "無法回到既有場次，請稍後再試",
          );
        }
      } else {
        setError(err instanceof ApiError ? err.message : "開啟場次失敗");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <BackLink href="/" label="回身分選擇" />

      <header className="mt-6 mb-6">
        <span className="flex h-12 w-12 items-center justify-center rounded-md border border-vermilion/50 bg-vermilion/10 text-2xl font-bold text-vermilion-soft">
          主
        </span>
        <h1 className="mt-4 text-2xl font-bold text-paper">開啟今日場次</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          輸入日期即可開場，系統會在 Google Sheet 建立當天專屬的分頁作為工作資料庫。
          若當天場次已開啟，輸入相同通行碼即可直接回到主持台。
        </p>
      </header>

      <Panel>
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="場次日期"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            placeholder="2026-08-16"
            inputMode="numeric"
            autoComplete="off"
            hint="也可以直接輸入 20260816 或 8/16"
          />
          <Field
            label="場次名稱（選填）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例：週六下午場"
            autoComplete="off"
          />
          <Field
            label="主持通行碼"
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="至少 4 個字"
            autoComplete="current-password"
            hint="用來保護主持台，請自行記住，玩家不需要知道"
          />

          {error ? <Notice>{error}</Notice> : null}
          {info ? <Notice kind="success">{info}</Notice> : null}

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "處理中…" : "開啟／進入場次"}
          </Button>
        </form>
      </Panel>
    </PageShell>
  );
}
