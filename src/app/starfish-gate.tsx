"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";

/**
 * 首頁的海星，也是主持人的秘密入口。
 *
 * 從最上面那隻腳開始，順時針依序點五隻腳（每下間隔 4 秒內），海星轉一圈後浮出主持人入口。
 * 點錯順序或停太久就默默歸零。每一下都只會讓那隻腳閃一下，看起來像裝飾在回應觸碰，
 * 不會顯示進度，玩家亂點也不會發現是密碼。
 *
 * 主持頁本身仍有密碼保護；這裡只是不讓玩家看到入口。
 */

const TAP_WINDOW_MS = 4000;
// 五隻腳的角度：頂端開始順時針
const ARMS = [-90, -18, 54, 126, 198].map((deg) => (deg * Math.PI) / 180);
const at = (angle: number, r: number) => [50 + r * Math.cos(angle), 50 + r * Math.sin(angle)] as const;

// 海星外形：五個尖端與五個內凹點交錯，圓角接起來
const OUTLINE = ARMS.flatMap((a) => [at(a, 46), at(a + Math.PI / 5, 17)])
  .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
  .join(" ");

export function StarfishGate({ hosts, children }: { hosts: { id: string; title: string; href: string }[]; children?: ReactNode }) {
  const [glow, setGlow] = useState<number | null>(null);
  const [spin, setSpin] = useState(false);
  const [open, setOpen] = useState(false);
  const progress = useRef({ step: 0, last: 0 });

  function tap(i: number) {
    setGlow(i);
    setTimeout(() => setGlow((g) => (g === i ? null : g)), 350);
    if (open) return;

    const p = progress.current;
    const now = Date.now();
    const inTime = p.step === 0 || now - p.last < TAP_WINDOW_MS;
    // 點錯就歸零；點的是頂端那隻就當作重新開始的第一下
    p.step = i === p.step && inTime ? p.step + 1 : i === 0 ? 1 : 0;
    p.last = now;
    if (p.step === ARMS.length) {
      p.step = 0;
      setSpin(true);
      setTimeout(() => setOpen(true), 800);
    }
  }

  return (
    <>
      <div className="mx-auto h-24 w-24">
        <svg
          viewBox="0 0 100 100"
          className="h-full w-full text-gold/70"
          style={{ transform: spin ? "rotate(360deg)" : "none", transition: spin ? "transform 0.8s ease-in-out" : "none" }}
          aria-hidden
        >
          <polygon points={OUTLINE} fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          {ARMS.map((a, i) => {
            const [x1, y1] = at(a, 8);
            const [x2, y2] = at(a, 34);
            return (
              <g key={i}>
                {/* 腳上的一排小點，點到時亮起 */}
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="currentColor"
                  strokeWidth={glow === i ? 3 : 1.2}
                  strokeDasharray="0.1 4.5"
                  strokeLinecap="round"
                  style={{ transition: "stroke-width 0.2s", opacity: glow === i ? 1 : 0.6 }}
                />
                <circle
                  cx={at(a, 30)[0]}
                  cy={at(a, 30)[1]}
                  r="13"
                  fill="transparent"
                  className="cursor-default"
                  style={{ pointerEvents: "all", WebkitTapHighlightColor: "transparent" }}
                  onPointerDown={() => tap(i)}
                />
              </g>
            );
          })}
        </svg>
      </div>

      {open ? (
        <section className="fade-up mt-8 rounded-xl border border-vermilion/50 bg-panel/90 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-vermilion-soft">主持人入口</h2>
            <button type="button" onClick={() => (setOpen(false), setSpin(false))} className="text-xs text-muted hover:text-paper">
              收起
            </button>
          </div>
          <ul className="mt-3 space-y-2">
            {hosts.map((h) => (
              <li key={h.id}>
                <Link
                  href={h.href}
                  className="flex items-center justify-between rounded-lg border border-line bg-lacquer px-4 py-3 text-sm text-paper transition-colors hover:border-vermilion/60"
                >
                  <span>{h.title}</span>
                  <span className="text-xs text-muted">開場／回主持台 →</span>
                </Link>
              </li>
            ))}
          </ul>
          {children ? <div className="mt-4 text-xs text-muted/80">{children}</div> : null}
        </section>
      ) : null}
    </>
  );
}
