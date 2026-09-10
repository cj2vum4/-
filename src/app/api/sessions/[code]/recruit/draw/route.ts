import { handle, jsonOk, playerAuth, requireCode } from "@/lib/api-helpers";
import { assertPlayer, drawRecruit } from "@/lib/game";

export const dynamic = "force-dynamic";

/** 玩家抽一次招募 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    const { playerId, joinCode } = playerAuth(req);
    await assertPlayer(code, playerId, joinCode);
    return jsonOk(await drawRecruit(code, playerId));
  });
}
