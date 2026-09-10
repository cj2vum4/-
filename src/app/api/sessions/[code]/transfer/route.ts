import { handle, jsonOk, playerAuth, readJson, requireCode } from "@/lib/api-helpers";
import { assertPlayer, transferPower } from "@/lib/game";

export const dynamic = "force-dynamic";

/** 玩家把自己手上的勢力值轉給另一位玩家 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    const { playerId, joinCode } = playerAuth(req);
    await assertPlayer(code, playerId, joinCode);

    const body = await readJson<{ targetId?: string; amount?: number }>(req);
    const result = await transferPower(
      code,
      playerId,
      body.targetId ?? "",
      Number(body.amount),
    );
    return jsonOk(result);
  });
}
