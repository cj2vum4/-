import Link from "next/link";
import { SCRIPTS } from "@/lib/catalog";
import { diagnoseCredentials } from "@/lib/store/credentials";
import { StarfishGate } from "./starfish-gate";

export const dynamic = "force-dynamic";
export const metadata = { title: "海星劇本殺" };

/**
 * 首頁：選劇本。點進去的所有畫面都是玩家端。
 * 主持人從上方海星的秘密入口進（見 starfish-gate.tsx）。
 */
export default function HomePage() {
  const cred = diagnoseCredentials();
  const hasSheetId = Boolean((process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? "").trim());
  // 三種狀態要分清楚：設定好、設定了但壞掉、根本沒設定。
  // 中間那種最危險——若誤報成正常，主持人會辦完整場才發現什麼都沒存到。
  // 這是給主持人看的，只放在秘密入口裡。
  const mode: "sheets" | "broken" | "memory" =
    hasSheetId && cred.ok ? "sheets" : cred.source || hasSheetId ? "broken" : "memory";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-5 py-12">
      <header className="fade-up text-center">
        <StarfishGate hosts={SCRIPTS.map((s) => ({ id: s.id, title: s.title, href: s.hostHref }))}>
          九爺資料庫模式：
          {mode === "sheets" ? (
            <span className="text-jade-soft">Google Sheet（正式）</span>
          ) : mode === "broken" ? (
            <span className="text-vermilion-soft">⚠ 設定有誤，資料不會寫入試算表 —— 請開啟 /api/health 查看原因</span>
          ) : (
            <span className="text-vermilion-soft">記憶體暫存（未設定憑證，重啟即清空）</span>
          )}
        </StarfishGate>
        <h1 className="mt-5 text-3xl font-bold tracking-[0.3em] text-gold-soft sm:text-4xl">海星劇本殺</h1>
        <div className="mx-auto mt-5 flex items-center justify-center gap-3">
          <span className="h-px w-14 bg-line" />
          <span className="text-xs tracking-[0.3em] text-muted">選 一 個 故 事</span>
          <span className="h-px w-14 bg-line" />
        </div>
      </header>

      <div className="mt-10 grid gap-4">
        {SCRIPTS.map((s) => (
          <Link
            key={s.id}
            href={s.playerHref}
            className={`${s.theme ?? ""} fade-up group block rounded-xl border border-line bg-panel/80 px-5 py-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-gold/70`}
            style={{ minHeight: 0 }}
          >
            <h2 className="text-xl font-bold text-gold-soft">{s.title}</h2>
            <p className="mt-1 text-sm text-muted">{s.tagline}</p>
            <span className="mt-3 block text-xs tracking-[0.25em] text-muted/60 transition-colors group-hover:text-gold/80">進 入 →</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
