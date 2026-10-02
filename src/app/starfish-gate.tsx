"use client";

import Link from "next/link";
import { useRef, useState, type PointerEvent, type ReactNode } from "react";

/**
 * 首頁的海星主視覺（金色鑰匙孔海星），也是主持人的秘密入口。
 *
 * 手指按住海星、不放開地繞著它畫 3 圈（順時針或逆時針都可以，一筆要在 10 秒內畫完），
 * 鑰匙孔亮起、海星轉一圈後浮出主持人入口。畫的過程不顯示任何進度；放開手指就重算。
 * 只算繞著海星中心轉了幾圈，所以圈畫得歪、大小不一都沒關係，但手指太靠近中心的那幾段不算。
 *
 * 主持頁本身仍有密碼保護；這裡只是不讓玩家看到入口。
 */

const TURNS = 3;
const STROKE_MS = 10_000;
// 離中心不到半徑的這個比例就不算角度（經過中心時角度會亂跳）
const MIN_RADIUS = 0.18;
// 鑰匙孔的位置（百分比，量自 public/brand/starfish.png）
const KEYHOLE: [number, number] = [50, 53];

export function StarfishGate({ hosts, children }: { hosts: { id: string; title: string; href: string }[]; children?: ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const stroke = useRef<{ last: number | null; total: number; start: number } | null>(null);

  /** 手指相對海星中心的角度；太靠近中心回傳 null */
  function angleOf(e: PointerEvent) {
    const r = box.current!.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(x, y) < (r.width / 2) * MIN_RADIUS) return null;
    return Math.atan2(y, x);
  }

  function down(e: PointerEvent<HTMLDivElement>) {
    if (unlocked) return;
    // 手指畫出海星範圍也繼續算；有些瀏覽器不讓抓就算了，畫在海星上一樣有效
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    stroke.current = { last: angleOf(e), total: 0, start: Date.now() };
  }

  function move(e: PointerEvent<HTMLDivElement>) {
    const s = stroke.current;
    if (!s || unlocked) return;
    // 一筆畫太久就從現在重新算
    if (Date.now() - s.start > STROKE_MS) Object.assign(s, { last: null, total: 0, start: Date.now() });
    const a = angleOf(e);
    if (a === null) return;
    if (s.last !== null) {
      let d = a - s.last;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      s.total += d;
    }
    s.last = a;
    if (Math.abs(s.total) >= TURNS * 2 * Math.PI) {
      stroke.current = null;
      setUnlocked(true);
      setTimeout(() => setOpen(true), 1100);
    }
  }

  const up = () => {
    stroke.current = null;
  };

  const spot = ([x, y]: [number, number]) => ({ left: `${x}%`, top: `${y}%` });

  return (
    <>
      <div
        ref={box}
        className="relative mx-auto h-40 w-40 select-none sm:h-48 sm:w-48"
        // 在海星上畫圈時不要捲動頁面
        style={{ touchAction: "none", WebkitTapHighlightColor: "transparent" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{ transform: unlocked ? "rotate(360deg)" : "none", transition: unlocked ? "transform 1s ease-in-out 0.2s" : "none" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/starfish.png" alt="海星劇本殺" draggable={false} className="h-full w-full" />
          {/* 解開時鑰匙孔亮起 */}
          <span
            aria-hidden
            className="absolute h-[22%] w-[22%] -translate-x-1/2 -translate-y-1/2 rounded-full mix-blend-screen"
            style={{
              ...spot(KEYHOLE),
              background: "radial-gradient(circle, rgba(255,90,60,0.9), transparent 70%)",
              opacity: unlocked ? 1 : 0,
              transition: "opacity 0.3s",
            }}
          />
        </div>
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
