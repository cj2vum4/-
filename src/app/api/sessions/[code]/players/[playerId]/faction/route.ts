import { handle, hostPin, jsonOk, readJson, requireCode } from "@/lib/api-helpers";
import type { Faction } from "@/lib/characters";
import { assertHost, setFaction } from "@/lib/game";

export const dynamic = "force-dynamic";

/** 設定玩家的真實陣營。僅主持人可用，對玩家保密。 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string; playerId: string }> },
) {
  return handle(async () => {
    const { code: raw, playerId } = await ctx.params;
    const code = requireCode(raw);
    await assertHost(code, hostPin(req));

    const body = await readJson<{ faction?: Faction | "" }>(req);
    await setFaction(code, playerId, body.faction ?? "");
    return jsonOk({ playerId });
  });
}
