"use client";

import { useState, type CSSProperties } from "react";
import { Button } from "@/components/ui";
import { MAX_DREAMERS, OTHERS, OTHERS_LABEL, pairSlot, slotLabel } from "@/lib/online/circle";
import type { CircleOp, CirclePair, CircleView } from "@/lib/online/types";

/**
 * 瘋兔子第三～五幕：飛昇法陣，玩家和主持人一起編輯同一張。
 * 照板書：六芒星六個角各一組「兇手→死者」、中央一格，左邊是「分身→夢主」對照表。
 * 點一格 → 下面跳出名字讓你選；同一格兩個人同時改，以後按的為準，格子下面會寫誰改的。
 */

// 六個角在方框裡的位置（百分比），順時針從頂端開始；名字放在尖角外側
const CORNER_POS: [number, number][] = [
  [50, 5],
  [88, 25],
  [88, 75],
  [50, 95],
  [12, 75],
  [12, 25],
];

export function CircleBoard({
  circle,
  host = false,
  busy,
  onOp,
}: {
  circle: CircleView;
  host?: boolean;
  busy: boolean;
  onOp: (op: CircleOp) => void;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const canEdit = !busy && (host || !circle.locked);
  const short = (id: string) => circle.names.find((n) => n.id === id)?.short ?? "？";
  const full = (id: string) => circle.names.find((n) => n.id === id)?.name ?? id;
  const pairText = (p: CirclePair) => `${p.killer ? short(p.killer) : "？"}→${p.victim ? short(p.victim) : "？"}`;
  const rowLabel = (row: string) => (row === OTHERS ? OTHERS_LABEL : full(row));

  const slotButton = (slot: string, p: CirclePair, style?: CSSProperties) => (
    <button
      type="button"
      onClick={() => setSel(sel === slot ? null : slot)}
      style={style}
      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-md border px-2 py-1 text-base font-bold whitespace-nowrap transition-colors ${
        sel === slot ? "border-gold bg-gold/20 text-gold-soft" : p.killer || p.victim ? "border-line bg-panel text-paper" : "border-dashed border-line bg-lacquer/80 text-muted"
      }`}
    >
      {pairText(p)}
    </button>
  );

  const at = sel ? pairSlot(sel) : null;
  const pair = at === "center" ? circle.center : typeof at === "number" ? circle.star[at] : null;
  const row = sel?.startsWith("d:") ? sel.slice(2) : null;

  return (
    <div className="space-y-3">
      {circle.locked ? (
        <p className="rounded-md border border-vermilion/50 bg-vermilion/10 px-3 py-2 text-xs text-vermilion-soft">
          🔒 主持人已鎖定陣法{host ? "，玩家不能修改" : "，等主持人解除後才能修正"}
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-muted">點六芒星的角或中央填「兇手→死者」，點對照表的一列填夢主。大家看到的是同一張，改了幾秒內就會同步。</p>
      )}

      <div className="relative mx-auto aspect-square w-full max-w-sm">
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full text-gold/60" aria-hidden>
          <polygon points="50,16 81,70 19,70" fill="none" stroke="currentColor" strokeWidth="0.8" />
          <polygon points="50,84 81,30 19,30" fill="none" stroke="currentColor" strokeWidth="0.8" />
        </svg>
        {circle.star.map((p, i) => slotButton(`s${i}`, p, { left: `${CORNER_POS[i][0]}%`, top: `${CORNER_POS[i][1]}%` }))}
        {slotButton("center", circle.center, { left: "50%", top: "50%" })}
      </div>

      <div className="rounded-lg border border-line bg-lacquer/60">
        <div className="border-b border-line/60 px-3 py-2 text-xs tracking-[0.2em] text-muted">分身 → 夢主</div>
        <ul>
          {circle.rows.map((r) => {
            const slot = `d:${r}`;
            const list = circle.dreams[r] ?? [];
            return (
              <li key={r}>
                <button
                  type="button"
                  onClick={() => setSel(sel === slot ? null : slot)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${sel === slot ? "bg-gold/15" : ""}`}
                >
                  <span className="text-paper">
                    {rowLabel(r)} → <b className={list.length ? "text-gold-soft" : "font-normal text-muted"}>{list.length ? list.map(full).join("／") : "？"}</b>
                  </span>
                  {circle.by[slot] ? <span className="shrink-0 text-[11px] text-muted">{circle.by[slot]}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {sel && (pair || row) ? (
        <div className="space-y-2 rounded-lg border border-gold/40 bg-gold/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold text-gold-soft">{slotLabel(sel, circle.names)}</span>
            <span className="text-[11px] text-muted">{circle.by[sel] ? `最後由 ${circle.by[sel]} 修改` : "還沒有人填"}</span>
          </div>
          {pair ? (
            (["killer", "victim"] as const).map((field) => (
              <NamePicker
                key={field}
                label={field === "killer" ? "兇手" : "死者"}
                names={circle.names}
                chosen={pair[field] ? [pair[field]] : []}
                disabled={!canEdit}
                onPick={(id) => onOp({ op: "pair", slot: sel, field, value: pair[field] === id ? "" : id })}
              />
            ))
          ) : (
            <NamePicker
              label={`夢主（最多 ${MAX_DREAMERS} 個）`}
              names={circle.names}
              chosen={circle.dreams[row!] ?? []}
              disabled={!canEdit}
              onPick={(id) => {
                const list = circle.dreams[row!] ?? [];
                const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(-MAX_DREAMERS);
                onOp({ op: "dream", row: row!, value: next });
              }}
            />
          )}
          <p className="text-[11px] text-muted">再點一次已選的名字就會清掉。</p>
        </div>
      ) : null}

      {host ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={circle.locked ? "jade" : "primary"}
            disabled={busy}
            onClick={() => onOp({ op: "lock", on: !circle.locked })}
          >
            {circle.locked ? "解除鎖定（讓玩家修正）" : "鎖定陣法（開始飛昇）"}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm("清空整張陣法？六芒星、中央與對照表都會清掉。")) onOp({ op: "clear" });
            }}
          >
            清空
          </Button>
        </div>
      ) : null}

      {circle.log.length ? (
        <details className="rounded-md border border-line/60 bg-lacquer/60">
          <summary className="cursor-pointer px-3 py-2 text-xs text-muted">修改紀錄（{circle.log.length}）</summary>
          <ol className="max-h-56 space-y-0.5 overflow-y-auto border-t border-line/60 px-3 py-2 text-xs text-paper/85">
            {circle.log
              .slice()
              .reverse()
              .map((e, i) => (
                <li key={`${e.at}-${i}`}>
                  <span className="text-muted">{new Date(e.at).toLocaleTimeString("zh-TW")}</span> {e.who}：{e.action}
                </li>
              ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}

function NamePicker({
  label,
  names,
  chosen,
  disabled,
  onPick,
}: {
  label: string;
  names: CircleView["names"];
  chosen: string[];
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-xs text-muted">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {names.map((n) => {
          const on = chosen.includes(n.id);
          return (
            <button
              key={n.id}
              type="button"
              disabled={disabled}
              onClick={() => onPick(n.id)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-40 ${
                on ? "border-gold bg-gold/20 text-gold-soft" : "border-line text-paper/85"
              }`}
            >
              {n.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
