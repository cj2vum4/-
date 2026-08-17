import { handle, hostPin, jsonOk, readJson, requireCode } from "@/lib/api-helpers";
import { assertHost, setRecruitOpen } from "@/lib/game";

export const dynamic = "force-dynamic";

/** 主持人開啟／鎖定本階段的勢力招募 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    await assertHost(code, hostPin(req));

    const body = await readJson<{ open?: boolean }>(req);
    const session = await setRecruitOpen(code, Boolean(body.open));
    const { hostPin: _hidden, ...safe } = session;
    return jsonOk({ session: safe });
  });
}
