import { handle, jsonOk, readJson, requireCode } from "@/lib/api-helpers";
import { rejoinSession } from "@/lib/game";

export const dynamic = "force-dynamic";

/**
 * 玩家用暱稱認回已經被自己選走的角色。
 *
 * 掉線、換裝置、清掉瀏覽器資料之後的回場入口。
 * 回傳的 id 與通行碼要存回瀏覽器，之後才認得出是誰。
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    const body = await readJson<{ characterId?: string; nickname?: string }>(req);
    const player = await rejoinSession(code, body.characterId ?? "", body.nickname ?? "");
    return jsonOk({
      player: { id: player.id, name: player.name, joinCode: player.joinCode },
    });
  });
}
