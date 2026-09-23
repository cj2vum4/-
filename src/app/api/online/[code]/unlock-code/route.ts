import { handle, jsonOk, readJson } from "@/lib/api-helpers";
import { assertPlayer, requireOnlineCode, selfUnlock } from "@/lib/online/engine";

export const dynamic = "force-dynamic";

/** 玩家輸入主持人口頭給的線索代碼 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = requireOnlineCode((await ctx.params).code);
    const roleId = req.headers.get("x-role-id") ?? "";
    await assertPlayer(code, roleId, req.headers.get("x-player-token") ?? "");
    const body = await readJson<{ clueCode?: string }>(req);
    return jsonOk(await selfUnlock(code, roleId, body.clueCode ?? ""));
  });
}
