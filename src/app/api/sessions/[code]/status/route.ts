import { handle, hostPin, jsonOk, readJson, requireCode } from "@/lib/api-helpers";
import { assertHost, setSessionStatus } from "@/lib/game";
import { GameError } from "@/lib/errors";
import type { SessionStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const ALLOWED: SessionStatus[] = ["open", "paused", "closed"];

/** 主持人暫停／恢復／結束場次，另外也用來驗證主持通行碼 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    await assertHost(code, hostPin(req));

    const body = await readJson<{ status?: SessionStatus }>(req);
    const status = body.status;
    if (!status || !ALLOWED.includes(status)) {
      throw new GameError("BAD_REQUEST", "未知的場次狀態");
    }
    const session = await setSessionStatus(code, status);
    const { password: _hidden, ...safe } = session;
    return jsonOk({ session: safe });
  });
}
