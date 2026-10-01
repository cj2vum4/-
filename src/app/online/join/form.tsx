"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BackLink, Button, Field, Notice, PageShell } from "@/components/ui";
import { ApiError, onlineApi, saveIdentity } from "@/lib/online/client";
import { parseDateKey, todayKey } from "@/lib/online/date-code";
import { metaForCode } from "@/lib/online/meta";
import { DateCodeField } from "../date-field";
import type { OnlinePlayerIdentity, OnlineScriptId } from "@/lib/online/types";

type Found = { code: string; script: OnlineScriptId; status: "active" | "ended" };

/**
 * 玩家入場：輸入場次號碼（8 位數字的日期）和暱稱。
 * 暱稱對到那天某一場的玩家就直接回到自己的角色；對不到就是第一次來，進選角畫面。
 */
export function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [date, setDate] = useState(todayKey());
  const [nickname, setNickname] = useState("");
  const [choices, setChoices] = useState<Found[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const role = params.get("role");

  const toLobby = (code: string) => {
    const q = new URLSearchParams();
    if (role) q.set("role", role);
    if (nickname.trim()) q.set("nickname", nickname.trim());
    router.push(`/online/play/${code}${q.toString() ? `?${q}` : ""}`);
  };

  // 從主持人給的連結進來時，場次已經帶好，直接進選角
  useEffect(() => {
    const preset = params.get("code")?.toUpperCase();
    if (preset && metaForCode(preset)) router.replace(`/online/play/${preset}${role ? `?role=${encodeURIComponent(role)}` : ""}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function go() {
    if (date.length !== 8 || !parseDateKey(date)) {
      setError("場次號碼是 8 位數字的日期，例如 20261001");
      return;
    }
    setBusy(true);
    setError("");
    setChoices([]);
    try {
      const r = await onlineApi<{ sessions: Found[]; identity?: OnlinePlayerIdentity }>("/find", {
        method: "POST",
        body: JSON.stringify({ date, nickname }),
      });
      if (r.identity) {
        saveIdentity(r.identity);
        router.push(`/online/play/${r.identity.code}`);
        return;
      }
      if (r.sessions.length === 1) toLobby(r.sessions[0].code);
      else setChoices(r.sessions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "找不到場次");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <BackLink href="/online" label="線上主持" />
      <h1 className="mt-4 text-2xl font-bold text-gold-soft">玩家入場</h1>
      <p className="mt-2 text-sm text-muted">輸入主持人給的場次號碼和你的暱稱。第一次來會進到選角；之前來過，用同一個暱稱就能回到你的角色。</p>
      <div className="mt-6 space-y-3">
        <DateCodeField value={date} onChange={(v) => (setDate(v), setError(""), setChoices([]))} />
        <Field
          label="你的暱稱"
          hint="主持人會用這個名字稱呼你；之後換手機或重新整理，也是用它回來。"
          maxLength={20}
          value={nickname}
          onChange={(e) => (setNickname(e.target.value), setError(""))}
          onKeyDown={(e) => e.key === "Enter" && date.length === 8 && nickname.trim() && void go()}
          autoComplete="off"
        />
        {error ? <Notice>{error}</Notice> : null}
        <Button className="w-full" disabled={busy || date.length !== 8 || !nickname.trim()} onClick={go}>
          進入場次
        </Button>
      </div>

      {choices.length ? (
        <div className="mt-5 space-y-2">
          <p className="text-sm text-muted">這一天有 {choices.length} 個劇本開場，請選你要玩的：</p>
          {choices.map((c) => {
            const m = metaForCode(c.code);
            return (
              <button
                key={c.code}
                type="button"
                onClick={() => toLobby(c.code)}
                className={`${m?.theme ?? ""} block w-full rounded-lg border border-line bg-panel px-4 py-3 text-left`}
              >
                <span className="block font-bold text-gold-soft">{m?.title ?? c.code}</span>
                <span className="text-xs text-muted">{m?.players}{c.status === "ended" ? "・已結束" : ""}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </PageShell>
  );
}
