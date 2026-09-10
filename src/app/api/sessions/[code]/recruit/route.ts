import { handle, hostPin, jsonOk, requireCode } from "@/lib/api-helpers";
import { assertHost, resetRecruit } from "@/lib/game";

export const dynamic = "force-dynamic";

/**
 * 主持人重新發放本階段的招募次數並重建彩池。
 * 招募的開關已改為由階段自動決定，這支只用於補發。
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    await assertHost(code, hostPin(req));
    return jsonOk(await resetRecruit(code));
  });
}
