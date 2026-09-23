"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BackLink, Button, Field, Notice, PageShell } from "@/components/ui";
import { metaForCode } from "@/lib/online/meta";

/** 玩家輸入主持人給的場次代碼。代碼前綴決定是哪個劇本 */
export function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [error, setError] = useState("");
  const role = params.get("role");

  const go = (raw: string) => {
    const c = raw.trim().toUpperCase().replace(/\s+/g, "");
    if (!metaForCode(c)) {
      setError("代碼格式不正確，請向主持人確認（例如 TC-7K2M9Q、RT-4HX8PA）");
      return;
    }
    router.push(`/online/play/${c}${role ? `?role=${encodeURIComponent(role)}` : ""}`);
  };

  // 從主持人給的連結進來時，代碼已經帶好，直接進選角
  useEffect(() => {
    const preset = params.get("code");
    if (preset && metaForCode(preset.toUpperCase())) go(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PageShell>
      <BackLink href="/online" label="線上主持" />
      <h1 className="mt-4 text-2xl font-bold text-gold-soft">玩家入場</h1>
      <p className="mt-2 text-sm text-muted">輸入主持人提供的場次代碼。</p>
      <div className="mt-6 space-y-3">
        <Field
          label="場次代碼"
          placeholder="TC-XXXXXX"
          value={code}
          onChange={(e) => (setCode(e.target.value), setError(""))}
          onKeyDown={(e) => e.key === "Enter" && go(code)}
          autoCapitalize="characters"
          autoComplete="off"
        />
        {error ? <Notice>{error}</Notice> : null}
        <Button className="w-full" disabled={!code.trim()} onClick={() => go(code)}>
          下一步：選擇角色
        </Button>
      </div>
    </PageShell>
  );
}
