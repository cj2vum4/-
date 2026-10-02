import { APP_NAME } from "./config";
import { ONLINE_META } from "./online/meta";

/**
 * 首頁的劇本清單。新增劇本時在這裡加一筆：
 *   playerHref：玩家入口（首頁卡片點進去的地方）
 *   hostHref  ：主持人入口（只出現在首頁的秘密入口裡）
 *   theme     ：卡片配色（globals.css 的 theme-* class），沒有就用預設的金色
 *
 * 只放公開介紹，前端可以放心拿。
 */
export interface ScriptEntry {
  id: string;
  title: string;
  tagline: string;
  playerHref: string;
  hostHref: string;
  theme?: string;
}

export const SCRIPTS: ScriptEntry[] = [
  {
    id: "fengtuz",
    title: ONLINE_META.fengtuz.title,
    tagline: ONLINE_META.fengtuz.tagline,
    playerHref: "/online/join?script=fengtuz",
    hostHref: "/online/host?script=fengtuz",
    theme: ONLINE_META.fengtuz.theme,
  },
  {
    id: "jiuye",
    title: APP_NAME,
    tagline: "宮廷養老互動遊戲・勢力與威望即時計分",
    playerHref: "/player",
    hostHref: "/host",
  },
  {
    id: "tiancai",
    title: ONLINE_META.tiancai.title,
    tagline: ONLINE_META.tiancai.tagline,
    playerHref: "/online/join?script=tiancai",
    hostHref: "/online/host?script=tiancai",
    theme: ONLINE_META.tiancai.theme,
  },
];
