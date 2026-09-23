import type { OnlineScriptId } from "./types";

/** 劇本的公開介紹（劇本殺官網上就看得到的資訊），可放心給前端用 */
export const ONLINE_META: Record<
  OnlineScriptId,
  { title: string; tagline: string; players: string; theme: string }
> = {
  fengtuz: {
    title: "瘋兔子，白又白，砍下腦袋飛起來",
    tagline: "6 人・驚悚怪談・線索卡即時發放",
    players: "6 人",
    theme: "theme-fengtuz",
  },
  tiancai: {
    title: "天才在左我在右",
    tagline: "7 人・雙本結構・劇本分幕開放",
    players: "7 人",
    theme: "theme-tiancai",
  },
};

export function metaForCode(code: string) {
  if (code.startsWith("RT-")) return { id: "fengtuz" as const, ...ONLINE_META.fengtuz };
  if (code.startsWith("TC-")) return { id: "tiancai" as const, ...ONLINE_META.tiancai };
  return null;
}
