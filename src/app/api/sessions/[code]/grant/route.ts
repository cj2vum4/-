import { handle, hostPin, jsonOk, readJson, requireCode } from "@/lib/api-helpers";
import { applyGrant, assertHost } from "@/lib/game";
import type { ResourceKey } from "@/lib/types";

export const dynamic = "force-dynamic";

interface GrantBody {
  playerIds?: string[] | "ALL";
  resource?: ResourceKey;
  delta?: number;
  reason?: string;
  operator?: string;
}

/** 主持人發放／扣除 威望值 或 勢力值，支援一次選多人或全體 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    await assertHost(code, hostPin(req));

    const body = await readJson<GrantBody>(req);
    const result = await applyGrant(code, {
      playerIds: body.playerIds ?? [],
      resource: (body.resource ?? "prestige") as ResourceKey,
      delta: Number(body.delta),
      reason: body.reason,
      operator: body.operator,
    });
    return jsonOk(result);
  });
}
