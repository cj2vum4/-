import { handle, jsonOk, readJson } from "@/lib/api-helpers";
import { joinOnline, requireOnlineCode } from "@/lib/online/engine";

export const dynamic = "force-dynamic";

/** 玩家選角入場；同角色＋同暱稱視為本人回來，拿回原本的通行憑證 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = requireOnlineCode((await ctx.params).code);
    const body = await readJson<{ roleId?: string; nickname?: string }>(req);
    const roleId = body.roleId ?? "";
    const { token } = await joinOnline(code, roleId, body.nickname ?? "");
    return jsonOk({ identity: { code, roleId, token } });
  });
}
