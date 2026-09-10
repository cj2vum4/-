import type { Faction } from "./characters";

/**
 * 劇本指定的真實陣營。
 *
 * ⚠️ **只能由伺服器端 import**（`src/lib/game.ts` 與 API routes）。
 *
 * 這份對應表刻意跟 `characters.ts` 分開：那個檔案被玩家端的 client component
 * import，內容會原封不動打包進瀏覽器的 JS bundle。陣營一旦進了 bundle，
 * 任何玩家打開 devtools 就能看到全場的真實陣營，整個陣營博弈就沒了。
 *
 * 主持人要顯示「劇本原本是哪一陣營」時，走 HostSnapshot 的 scriptFactions，
 * 由伺服器帶下來，不要在前端 import 這個檔案。
 *
 * 陸秉白預設為隱藏鬼老；他若選擇加入其他陣營，由主持人在設定分頁改，
 * 不改這裡。
 */
export const CHARACTER_FACTIONS: Record<string, Faction> = {
  zhouqian: "九爺",
  shenshiyue: "九爺",
  jixiuyuan: "九爺",
  chenjiashu: "紅姑娘",
  liwanxu: "紅姑娘",
  shangyu: "紅姑娘",
  lubingbai: "隱藏鬼老",
};

export function scriptFaction(characterId: string): Faction | "" {
  return CHARACTER_FACTIONS[characterId] ?? "";
}
