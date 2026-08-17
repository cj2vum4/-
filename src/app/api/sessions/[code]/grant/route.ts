import { handle, hostPin, jsonOk, readJson, requireCode } from "@/lib/api-helpers";
import type { LedgerSource } from "@/lib/config";
import { applyGrant, assertHost } from "@/lib/game";
import type { ResourceKey } from "@/lib/types";

export const dynamic = "force-dynamic";

interface GrantBody {
  playerIds?: string[] | "ALL";
  resource?: ResourceKey;
  delta?: number;
  source?: LedgerSource;
  reason?: string;
  operator?: string;
}

/** 主持人調配勢力值／威望值／血量，支援一次選多人或全體 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    await assertHost(code, hostPin(req));

    const body = await readJson<GrantBody>(req);
    const result = await applyGrant(code, {
      playerIds: body.playerIds ?? [],
      resource: (body.resource ?? "power") as ResourceKey,
      delta: Number(body.delta),
      source: body.source,
      reason: body.reason,
      operator: body.operator,
    });
    return jsonOk(result);
  });
}
