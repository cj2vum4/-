import { handle, jsonOk, playerAuth, readJson, requireCode } from "@/lib/api-helpers";
import { assertPlayer, useSkillCard } from "@/lib/game";

export const dynamic = "force-dynamic";

/** 玩家使用手上的技能卡，需指定目標 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    const { playerId, joinCode } = playerAuth(req);
    await assertPlayer(code, playerId, joinCode);

    const body = await readJson<{ cardId?: string; targetId?: string }>(req);
    const result = await useSkillCard(
      code,
      playerId,
      body.cardId ?? "",
      body.targetId ?? "",
    );
    return jsonOk(result);
  });
}
