import { handle, hostPin, jsonOk } from "@/lib/api-helpers";
import { assertHost, hostCatalog, requireOnlineCode } from "@/lib/online/engine";

export const dynamic = "force-dynamic";

/** 主持台的線索全集與手冊。只給主持人，而且只在開台時抓一次，不放在輪詢裡 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = requireOnlineCode((await ctx.params).code);
    await assertHost(code, hostPin(req));
    return jsonOk({ catalog: await hostCatalog(code) });
  });
}
