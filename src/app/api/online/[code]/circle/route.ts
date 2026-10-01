import { handle, jsonOk, readJson } from "@/lib/api-helpers";
import { assertPlayer, playerCircle, playerSnapshot, requireOnlineCode } from "@/lib/online/engine";
import type { CircleOp } from "@/lib/online/types";

export const dynamic = "force-dynamic";

/** 玩家編輯飛昇法陣：六芒星的兇手→死者、中央一格、分身→夢主對照表 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = requireOnlineCode((await ctx.params).code);
    const roleId = req.headers.get("x-role-id") ?? "";
    await assertPlayer(code, roleId, req.headers.get("x-player-token") ?? "");
    const op = await readJson<CircleOp>(req);
    await playerCircle(code, roleId, op);
    return jsonOk({ player: await playerSnapshot(code, roleId) });
  });
}
