import { handle, jsonOk, readJson } from "@/lib/api-helpers";
import { assertPlayer, playerPoker, playerSnapshot, requireOnlineCode, type PokerPlayerOp } from "@/lib/online/engine";

export const dynamic = "force-dynamic";

/** 玩家在撲克牌局的操作：驗牌時洗牌；輪到自己和陸江遠對賭時抽牌或停止 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = requireOnlineCode((await ctx.params).code);
    const roleId = req.headers.get("x-role-id") ?? "";
    await assertPlayer(code, roleId, req.headers.get("x-player-token") ?? "");
    const body = await readJson<{ op?: PokerPlayerOp }>(req);
    await playerPoker(code, roleId, body.op ?? ("" as PokerPlayerOp));
    return jsonOk({ player: await playerSnapshot(code, roleId) });
  });
}
