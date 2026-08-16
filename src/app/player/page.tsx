"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api } from "@/lib/client";
import { normalizeSessionCode, todayCode } from "@/lib/date";
import { BackLink, Button, Field, Notice, PageShell, Panel } from "@/components/ui";

export default function PlayerEntryPage() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const code = normalizeSessionCode(value);
    if (!code) {
      setError("無此場次");
      return;
    }

    setBusy(true);
    try {
      // 先確認場次存在，不存在就直接回「無此場次」
      await api(`/api/sessions/${code}`);
      router.push(`/player/${code}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "SESSION_NOT_FOUND") {
        setError("無此場次");
      } else {
        setError(err instanceof ApiError ? err.message : "查詢失敗，請稍後再試");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <BackLink href="/" label="回身分選擇" />

      <header className="mt-6 mb-6">
        <span className="flex h-12 w-12 items-center justify-center rounded-md border border-gold/50 bg-gold/10 text-2xl font-bold text-gold-soft">
          賓
        </span>
        <h1 className="mt-4 text-2xl font-bold text-paper">進入場次</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          請輸入主持人今天開啟的場次日期。
        </p>
      </header>

      <Panel>
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="場次日期"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={todayCode()}
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            hint="例如 2026-08-16，也可以輸入 20260816 或 8/16"
          />

          {error ? <Notice>{error}</Notice> : null}

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "查詢中…" : "進入場次"}
          </Button>
        </form>
      </Panel>
    </PageShell>
  );
}
