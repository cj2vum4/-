import { handle, hostPin, jsonOk, readJson, requireCode } from "@/lib/api-helpers";
import { assertHost, settleAuction } from "@/lib/game";

export const dynamic = "force-dynamic";

/** 拍賣結算：先扣得標者的出價，再入帳標的的真實價值 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    await assertHost(code, hostPin(req));

    const body = await readJson<{
      playerId?: string;
      lotId?: string;
      paid?: number;
      value?: number;
    }>(req);

    return jsonOk(
      await settleAuction(code, {
        playerId: body.playerId ?? "",
        lotId: body.lotId ?? "",
        paid: Number(body.paid),
        value: body.value === undefined ? undefined : Number(body.value),
      }),
    );
  });
}
