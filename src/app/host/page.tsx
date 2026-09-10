"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api, saveHostPin } from "@/lib/client";
import { BackLink, Button, Field, Notice, PageShell, Panel } from "@/components/ui";

/**
 * 主持人入口。
 *
 * 只要一組開場密碼：沒開過就開新場，開過了就回到主持台。
 * 場次代碼由當天日期自動產生，主持人不用輸入日期——同一天開第二場會自動加序號。
 */
export default function HostEntryPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const pw = password.trim();
    if (pw.length < 4) {
      setError("開場密碼至少 4 個字");
      return;
    }

    setBusy(true);
    try {
      const created = await api<{ session: { code: string } }>(`/api/sessions`, {
        method: "POST",
        body: JSON.stringify({ password: pw, title }),
      });
      saveHostPin(created.session.code, pw);
      router.push(`/host/${created.session.code}`);
    } catch (err) {
      // 這組密碼已經有一場在進行 → 回到那一場，不用另外記場次代碼
      if (err instanceof ApiError && err.code === "SESSION_EXISTS") {
        try {
          const found = await api<{ session: { code: string } }>(`/api/sessions/lookup`, {
            method: "POST",
            body: JSON.stringify({ password: pw }),
          });
          const code = found.session.code;
          await api(`/api/sessions/${code}/verify-host`, { method: "POST", hostPin: pw });
          saveHostPin(code, pw);
          setInfo("這組密碼的場次已經開著，正在回到主持台…");
          router.push(`/host/${code}`);
          return;
        } catch {
          setError("無法回到既有場次，請稍後再試");
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
        <h1 className="mt-4 text-2xl font-bold text-paper">開啟場次</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          自訂一組開場密碼，把它唸給玩家，他們用同一組進場。
          同一天可以開很多場，彼此不會互相干擾。
        </p>
      </header>

      <Panel>
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="開場密碼"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 4 個字"
            autoComplete="off"
            hint="玩家用同一組密碼進場。已經開著的場次輸入同一組就會回到主持台。"
          />
          <Field
            label="場次名稱（選填）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例：週六下午場"
            autoComplete="off"
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
