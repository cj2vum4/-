import { handle, jsonOk, readJson, requireCode } from "@/lib/api-helpers";
import { joinSession } from "@/lib/game";

export const dynamic = "force-dynamic";

/** 玩家入場。回傳的 id 與通行碼要存在瀏覽器，重新整理才認得出是誰 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    const body = await readJson<{ name?: string; faction?: string }>(req);
    const player = await joinSession(code, body.name ?? "", body.faction ?? "");
    return jsonOk({ player });
  });
}
