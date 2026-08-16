"use client";

import { useEffect, useRef, useState } from "react";
import type { ResourceDef } from "@/lib/types";

/** 數值變動時閃一下，讓玩家一眼看到自己被加減了 */
export function ResourceStat({
  def,
  value,
  size = "md",
}: {
  def: ResourceDef;
  value: number;
  size?: "md" | "lg";
}) {
  const [pop, setPop] = useState(false);
  const prev = useRef(value);

  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setPop(true);
      const t = setTimeout(() => setPop(false), 450);
      return () => clearTimeout(t);
    }
  }, [value]);

  const tone =
    def.key === "prestige"
      ? "border-gold/35 bg-gold/8 text-gold-soft"
      : "border-jade/35 bg-jade/8 text-jade-soft";

  return (
    <div className={`rounded-xl border px-4 py-4 text-center ${tone}`}>
      <p className="text-xs tracking-[0.3em] opacity-75">{def.label}</p>
      <p
        className={`tabular mt-1.5 font-bold ${size === "lg" ? "text-5xl" : "text-3xl"} ${pop ? "value-pop" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
