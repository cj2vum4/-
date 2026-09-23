import { handle, hostPin, jsonOk, readJson } from "@/lib/api-helpers";
import {
  assertHost,
  hostAction,
  hostSnapshot,
  requireOnlineCode,
  type HostAction,
} from "@/lib/online/engine";

export const dynamic = "force-dynamic";

/** 主持人的所有操作都走這支：切階段、發線索、收回、解鎖、廣播、結束 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = requireOnlineCode((await ctx.params).code);
    await assertHost(code, hostPin(req));
    const body = await readJson<HostAction>(req);
    await hostAction(code, body);
    return jsonOk({ host: await hostSnapshot(code) });
  });
}
