import { handle, jsonOk, playerAuth, requireCode } from "@/lib/api-helpers";
import { getReviewSnapshot } from "@/lib/game";

export const dynamic = "force-dynamic";

/**
 * 封存後的個人回顧。
 *
 * 場次結束後工作分頁就刪了，這支從彙整分頁把玩家自己的紀錄讀回來。
 * 認證一樣是玩家代碼 + 通行碼，瀏覽器裡存的身分直接就能用。
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    const { playerId, joinCode } = playerAuth(req);
    return jsonOk(await getReviewSnapshot(code, playerId, joinCode));
  });
}
