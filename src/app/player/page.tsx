"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api } from "@/lib/client";
import { BackLink, Button, Field, Notice, PageShell, Panel } from "@/components/ui";

/**
 * 玩家入口。輸入主持人給的開場密碼即可，不用記日期。
 * 找不到（或那一場已結束）一律顯示「無此場次」。
 */
export default function PlayerEntryPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const pw = password.trim();
    if (!pw) {
      setError("無此場次");
      return;
    }

    setBusy(true);
    try {
      const found = await api<{ session: { code: string } }>(`/api/sessions/lookup`, {
        method: "POST",
        body: JSON.stringify({ password: pw }),
      });
      router.push(`/player/${found.session.code}`);
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
          請輸入主持人給的開場密碼。
        </p>
      </header>

      <Panel>
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="開場密碼"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="主持人會告訴你"
            autoComplete="off"
            autoFocus
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
