import { handle, hostPin, jsonOk, requireCode } from "@/lib/api-helpers";
import { assertHost, removePlayer } from "@/lib/game";

export const dynamic = "force-dynamic";

/** 主持人把玩家移出場次（資料仍留在 Sheet，只是標記為 removed） */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ code: string; playerId: string }> },
) {
  return handle(async () => {
    const { code: raw, playerId } = await ctx.params;
    const code = requireCode(raw);
    await assertHost(code, hostPin(req));
    await removePlayer(code, playerId);
    return jsonOk({ removed: playerId });
  });
}
