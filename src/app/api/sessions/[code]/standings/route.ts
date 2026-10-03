import { handle, hostPin, jsonOk, requireCode } from "@/lib/api-helpers";
import { assertHostReadOnly, getStandings } from "@/lib/game";

export const dynamic = "force-dynamic";

/**
 * 最終排名預覽（依陣營 → 累計獲得勢力）。
 *
 * 要讀完整流水帳才算得出累計，成本比一般輪詢高，所以不放進 /state——
 * 主持台只在要發聘書時打這一支。
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    await assertHostReadOnly(code, hostPin(req));
    return jsonOk({ standings: await getStandings(code) });
  });
}
