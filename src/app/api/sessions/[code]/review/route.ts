import { handle, jsonOk, requireCode } from "@/lib/api-helpers";
import { getReviewRoster, getReviewSnapshot } from "@/lib/game";

export const dynamic = "force-dynamic";

/**
 * 封存後的個人回顧。
 *
 * 兩種用法：
 *   不帶參數      → 回傳角色名單，讓回來的人自己挑
 *   ?player=<代碼> → 回傳那個角色的成績、聘書與紀錄
 *
 * 刻意不驗身分：場次結束後這裡什麼都不能操作，只剩紀錄可看，
 * 而且玩家換過手機、清掉瀏覽器資料之後本來就沒有身分可驗了。
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);

    const playerId = new URL(req.url).searchParams.get("player") ?? "";
    if (!playerId) {
      return jsonOk({ roster: await getReviewRoster(code) });
    }
    return jsonOk(await getReviewSnapshot(code, playerId));
  });
}
