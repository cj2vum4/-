import { handle, jsonOk, readJson, requireCode } from "@/lib/api-helpers";
import { joinSession } from "@/lib/game";

export const dynamic = "force-dynamic";

/** 玩家選角入場。回傳的 id 與通行碼要存在瀏覽器，重新整理才認得出是誰 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    const body = await readJson<{ characterId?: string; nickname?: string }>(req);
    const player = await joinSession(code, body.characterId ?? "", body.nickname ?? "");
    return jsonOk({
      player: { id: player.id, name: player.name, joinCode: player.joinCode },
    });
  });
}
