import { handle, hostPin, jsonOk, readJson, requireCode } from "@/lib/api-helpers";
import type { HiddenBranch } from "@/lib/characters";
import { assertHost, setHiddenBranch } from "@/lib/game";
import { GameError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** 設定陸秉白的隱藏分支。依規則設定後即鎖定，不可再更改。 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string; playerId: string }> },
) {
  return handle(async () => {
    const { code: raw, playerId } = await ctx.params;
    const code = requireCode(raw);
    await assertHost(code, hostPin(req));

    const body = await readJson<{ branch?: HiddenBranch }>(req);
    if (!body.branch) throw new GameError("BAD_REQUEST", "請指定隱藏分支");
    await setHiddenBranch(code, playerId, body.branch);
    return jsonOk({ playerId, branch: body.branch });
  });
}
