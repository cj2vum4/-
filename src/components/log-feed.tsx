"use client";

import { formatTime } from "@/lib/date";
import type { LogEntry } from "@/lib/types";

const TYPE_LABEL: Record<string, string> = {
  session: "場次",
  join: "入場",
  grant: "調配",
  stage: "階段",
  recruit: "招募",
  faction: "陣營",
  branch: "分支",
  report: "舉報",
  investigate: "調查",
  note: "備註",
};

export function LogFeed({
  log,
  empty = "尚無紀錄",
  showSource = false,
}: {
  log: LogEntry[];
  empty?: string;
  /** 主持台會顯示來源類型，方便事後對帳；玩家端不需要 */
  showSource?: boolean;
}) {
  if (log.length === 0) {
    return <p className="py-6 text-center text-sm text-muted/70">{empty}</p>;
  }

  return (
    <ul className="divide-y divide-line/60">
      {log.map((e, i) => (
        <li key={`${e.ts}-${i}`} className="flex items-start gap-2.5 py-2.5 text-sm">
          <span className="tabular shrink-0 pt-0.5 text-xs text-muted/60">
            {formatTime(e.ts)}
          </span>
          <span className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-muted">
            {TYPE_LABEL[e.type] ?? e.type}
          </span>
          <span className="min-w-0 flex-1 text-paper/85">
            {e.playerName ? <b className="text-paper">{e.playerName}</b> : null}
            {e.playerName ? " " : ""}
            {e.reason}
            {e.delta !== "" ? (
              <>
                {" "}
                <b className={Number(e.delta) > 0 ? "text-jade-soft" : "text-vermilion-soft"}>
                  {Number(e.delta) > 0 ? "+" : ""}
                  {e.delta} {e.resource}
                </b>
                <span className="text-muted/70"> → {e.balanceAfter}</span>
              </>
            ) : null}
            {showSource && e.source ? (
              <span className="ml-1.5 text-[10px] text-muted/50">［{e.source}］</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
