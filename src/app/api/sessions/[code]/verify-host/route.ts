import { handle, hostPin, jsonOk, requireCode } from "@/lib/api-helpers";
import { assertHost } from "@/lib/game";

export const dynamic = "force-dynamic";

/** 主持人回到既有場次時驗證通行碼 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    const session = await assertHost(code, hostPin(req));
    const { password: _hidden, ...safe } = session;
    return jsonOk({ session: safe });
  });
}
