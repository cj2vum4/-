import { handle, jsonOk } from "@/lib/api-helpers";
import { lobby, requireOnlineCode } from "@/lib/online/engine";

export const dynamic = "force-dynamic";

/** 玩家選角畫面：角色的公開介紹與是否已被選走。不含任何劇本內容 */
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = requireOnlineCode((await ctx.params).code);
    return jsonOk({ lobby: await lobby(code) });
  });
}
