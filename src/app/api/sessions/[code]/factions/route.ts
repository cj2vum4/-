import { handle, hostPin, jsonOk, requireCode } from "@/lib/api-helpers";
import { applyScriptFactions, assertHost } from "@/lib/game";

export const dynamic = "force-dynamic";

/** 把劇本指定的陣營套用到還沒設定陣營的玩家 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    await assertHost(code, hostPin(req));
    return jsonOk(await applyScriptFactions(code));
  });
}
