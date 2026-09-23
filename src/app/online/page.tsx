import Link from "next/link";
import { ONLINE_META } from "@/lib/online/meta";
import type { OnlineScriptId } from "@/lib/online/types";

export const metadata = { title: "線上主持 · 海星劇本殺" };

/** 線上主持的入口：選劇本，再選主持人或玩家 */
export default function OnlineHub() {
  const ids = Object.keys(ONLINE_META) as OnlineScriptId[];
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-5 py-12">
      <header className="fade-up text-center">
        <p className="text-sm tracking-[0.5em] text-gold/70">線 上 主 持</p>
        <h1 className="mt-4 text-3xl font-bold text-gold-soft">線索與劇本即時發放</h1>
        <p className="mt-3 text-sm text-muted">
          主持人開場後，玩家用手機輸入場次代碼入場，只會收到發給自己的內容。
        </p>
      </header>

      <div className="mt-10 grid gap-4">
        {ids.map((id) => {
          const m = ONLINE_META[id];
          return (
            <section key={id} className={`${m.theme} fade-up rounded-xl border border-line p-5`} style={{ minHeight: 0 }}>
              <h2 className="text-xl font-bold text-gold-soft">{m.title}</h2>
              <p className="mt-1 text-sm text-muted">{m.tagline}</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Link
                  href={`/online/join`}
                  className="rounded-lg border border-line bg-panel-2 py-3 text-center text-sm font-bold text-paper transition-colors hover:border-gold/60"
                >
                  我是玩家
                </Link>
                <Link
                  href={`/online/host?script=${id}`}
                  className="rounded-lg bg-gold py-3 text-center text-sm font-bold text-ink transition-colors hover:bg-gold-soft"
                >
                  我是主持人
                </Link>
              </div>
            </section>
          );
        })}
      </div>

      <p className="mt-10 text-center text-xs text-muted/70">
        <Link href="/" className="hover:text-gold">
          ← 九爺，我想給您養老
        </Link>
      </p>
    </main>
  );
}
