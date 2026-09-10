import { handle, hostPin, jsonOk, requireCode } from "@/lib/api-helpers";
import { assertHost, issueCertificates } from "@/lib/game";

export const dynamic = "force-dynamic";

/** 主持人發放會長就任聘書 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    await assertHost(code, hostPin(req));
    return jsonOk(await issueCertificates(code));
  });
}
