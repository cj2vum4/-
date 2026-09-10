import { handle, jsonOk, playerAuth, readJson, requireCode } from "@/lib/api-helpers";
import { assertPlayer, setNickname } from "@/lib/game";

export const dynamic = "force-dynamic";

/** 玩家補填或修改自己的暱稱，聘書要靠它署名 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    const { playerId, joinCode } = playerAuth(req);
    await assertPlayer(code, playerId, joinCode);

    const body = await readJson<{ nickname?: string }>(req);
    return jsonOk(await setNickname(code, playerId, body.nickname ?? ""));
  });
}
