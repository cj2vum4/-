import { handle, hostPin, jsonOk, readJson, requireCode } from "@/lib/api-helpers";
import { assertHost, judgeReport } from "@/lib/game";

export const dynamic = "force-dynamic";

/** 主持人判定舉報是否成立 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string; reportId: string }> },
) {
  return handle(async () => {
    const { code: raw, reportId } = await ctx.params;
    const code = requireCode(raw);
    await assertHost(code, hostPin(req));

    const body = await readJson<{ verdict?: "success" | "fail" }>(req);
    const report = await judgeReport(code, reportId, body.verdict ?? "success");
    return jsonOk({ report: { id: report.id, verdict: report.verdict } });
  });
}
