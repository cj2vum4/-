import { handle, jsonOk, playerAuth, requireCode } from "@/lib/api-helpers";
import { assertPlayer, useInvestigation } from "@/lib/game";

export const dynamic = "force-dynamic";

/** 玩家消耗一次調查機會，查詢是否有人舉報自己 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    const { playerId, joinCode } = playerAuth(req);
    await assertPlayer(code, playerId, joinCode);

    const result = await useInvestigation(code, playerId);
    return jsonOk(result);
  });
}
