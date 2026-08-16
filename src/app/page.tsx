import Link from "next/link";
import { APP_NAME } from "@/lib/config";
import { storageMode } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function LandingPage() {
  const mode = storageMode();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-5 py-12">
      <header className="text-center fade-up">
        <p className="text-sm tracking-[0.5em] text-gold/70">壹 玖 貳 柒</p>
        <h1 className="mt-5 text-4xl leading-tight font-bold text-gold-soft sm:text-5xl">
          {APP_NAME}
        </h1>
        <div className="mx-auto mt-6 flex items-center justify-center gap-3">
          <span className="h-px w-14 bg-line" />
          <span className="text-xs tracking-[0.3em] text-muted">請 表 明 身 分</span>
          <span className="h-px w-14 bg-line" />
        </div>
      </header>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <RoleCard
          href="/player"
          badge="賓"
          title="我是玩家"
          desc="輸入今日場次，入府爭取威望與勢力"
          accent="gold"
        />
        <RoleCard
          href="/host"
          badge="主"
          title="我是主持人"
          desc="開啟今日場次，調配全場資源與階段"
          accent="vermilion"
        />
      </div>

      <footer className="mt-12 text-center text-xs text-muted/70">
        <p>
          資料庫模式：
          {mode === "sheets" ? (
            <span className="text-jade-soft">Google Sheet（正式）</span>
          ) : (
            <span className="text-vermilion-soft">記憶體暫存（未設定憑證，重啟即清空）</span>
          )}
        </p>
      </footer>
    </main>
  );
}

function RoleCard({
  href,
  badge,
  title,
  desc,
  accent,
}: {
  href: string;
  badge: string;
  title: string;
  desc: string;
  accent: "gold" | "vermilion";
}) {
  const ring =
    accent === "gold"
      ? "hover:border-gold/70 hover:shadow-[0_0_30px_-8px_rgba(216,178,108,0.45)]"
      : "hover:border-vermilion/70 hover:shadow-[0_0_30px_-8px_rgba(196,69,58,0.45)]";
  const seal =
    accent === "gold"
      ? "border-gold/50 text-gold-soft bg-gold/10"
      : "border-vermilion/50 text-vermilion-soft bg-vermilion/10";

  return (
    <Link
      href={href}
      className={`fade-up group flex flex-col items-center rounded-xl border border-line bg-panel/80 px-6 py-10 text-center transition-all duration-200 hover:-translate-y-1 ${ring}`}
    >
      <span
        className={`flex h-16 w-16 items-center justify-center rounded-md border text-3xl font-bold ${seal}`}
      >
        {badge}
      </span>
      <h2 className="mt-5 text-2xl font-bold text-paper">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{desc}</p>
      <span className="mt-5 text-xs tracking-[0.25em] text-muted/60 transition-colors group-hover:text-gold/80">
        進 入 →
      </span>
    </Link>
  );
}
