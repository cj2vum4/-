import { handle, hostPin, jsonOk, readJson, requireCode } from "@/lib/api-helpers";
import { assertHost, setStage } from "@/lib/game";

export const dynamic = "force-dynamic";

/** 主持人切換遊戲階段 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    await assertHost(code, hostPin(req));

    const body = await readJson<{ stageId?: string }>(req);
    const session = await setStage(code, body.stageId ?? "");
    const { password: _hidden, ...safe } = session;
    return jsonOk({ session: safe });
  });
}
