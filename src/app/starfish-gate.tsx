"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";

/**
 * 首頁的海星主視覺（金色鑰匙孔海星），也是主持人的秘密入口。
 *
 * 從最上面那隻腳開始，順時針依序點五隻腳（每下間隔 4 秒內），鑰匙孔亮起、海星轉一圈後浮出主持人入口。
 * 點錯順序或停太久就默默歸零。每一下都只會讓那隻腳閃一下金光，看起來像裝飾在回應觸碰，
 * 不會顯示進度，玩家亂點也不會發現是密碼。
 *
 * 主持頁本身仍有密碼保護；這裡只是不讓玩家看到入口。
 */

const TAP_WINDOW_MS = 4000;
// 五隻腳在主視覺上的位置（百分比，量自 public/brand/starfish.png），頂端開始順時針
const ARMS: [number, number][] = [
  [51, 21],
  [78, 44],
  [63, 75],
  [31, 71],
  [23, 38],
];
// 鑰匙孔的位置
const KEYHOLE: [number, number] = [50, 53];

export function StarfishGate({ hosts, children }: { hosts: { id: string; title: string; href: string }[]; children?: ReactNode }) {
  const [glow, setGlow] = useState<number | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [open, setOpen] = useState(false);
  const progress = useRef({ step: 0, last: 0 });

  function tap(i: number) {
    setGlow(i);
    setTimeout(() => setGlow((g) => (g === i ? null : g)), 400);
    if (open || unlocked) return;

    const p = progress.current;
    const now = Date.now();
    const inTime = p.step === 0 || now - p.last < TAP_WINDOW_MS;
    // 點錯就歸零；點的是頂端那隻就當作重新開始的第一下
    p.step = i === p.step && inTime ? p.step + 1 : i === 0 ? 1 : 0;
    p.last = now;
    if (p.step === ARMS.length) {
      p.step = 0;
      setUnlocked(true);
      setTimeout(() => setOpen(true), 1100);
    }
  }

  const spot = ([x, y]: [number, number]) => ({ left: `${x}%`, top: `${y}%` });

  return (
    <>
      <div className="relative mx-auto h-40 w-40 select-none sm:h-48 sm:w-48" style={{ WebkitTapHighlightColor: "transparent" }}>
        <div
          className="absolute inset-0"
          style={{ transform: unlocked ? "rotate(360deg)" : "none", transition: unlocked ? "transform 1s ease-in-out 0.2s" : "none" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/starfish.png" alt="海星劇本殺" draggable={false} className="pointer-events-none h-full w-full" />
          {/* 點到的那隻腳閃一下金光 */}
          {ARMS.map((pos, i) => (
            <span
              key={i}
              aria-hidden
              className="pointer-events-none absolute h-[26%] w-[26%] -translate-x-1/2 -translate-y-1/2 rounded-full mix-blend-screen"
              style={{
                ...spot(pos),
                background: "radial-gradient(circle, rgba(255,214,140,0.55), transparent 65%)",
                opacity: glow === i ? 1 : 0,
                transition: "opacity 0.25s",
              }}
            />
          ))}
          {/* 解開時鑰匙孔亮起 */}
          <span
            aria-hidden
            className="pointer-events-none absolute h-[22%] w-[22%] -translate-x-1/2 -translate-y-1/2 rounded-full mix-blend-screen"
            style={{
              ...spot(KEYHOLE),
              background: "radial-gradient(circle, rgba(255,90,60,0.9), transparent 70%)",
              opacity: unlocked ? 1 : 0,
              transition: "opacity 0.3s",
            }}
          />
        </div>
        {ARMS.map((pos, i) => (
          <span
            key={i}
            aria-hidden
            data-arm={i}
            className="absolute h-[22%] w-[22%] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={spot(pos)}
            onPointerDown={() => tap(i)}
          />
        ))}
      </div>

      {open ? (
        <section className="fade-up mt-8 rounded-xl border border-vermilion/50 bg-panel/90 p-5 text-left">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-vermilion-soft">主持人入口</h2>
            <button type="button" onClick={() => (setOpen(false), setUnlocked(false))} className="text-xs text-muted hover:text-paper">
              收起
            </button>
          </div>
          <ul className="mt-3 space-y-2">
            {hosts.map((h) => (
              <li key={h.id}>
                <Link
                  href={h.href}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line bg-lacquer px-4 py-3 text-sm text-paper transition-colors hover:border-vermilion/60"
                >
                  <span>{h.title}</span>
                  <span className="shrink-0 text-xs text-muted">開場／回主持台 →</span>
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
