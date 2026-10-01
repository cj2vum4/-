"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { cardLabel, freshDeck, roundResult, total } from "@/lib/online/poker";
import type { PlayerPoker, PokerLogEntry, PokerState } from "@/lib/online/types";

/**
 * 瘋兔子第一幕：陸江遠的撲克牌比大小。
 * 玩家端（PlayerPokerTable）只拿得到看得見的牌（看不到的是 null）；主持台（HostPokerPanel）看得到全部。
 */

const MODE_TEXT = {
  inspect: "驗牌中",
  deal: "發牌中",
  reveal: "牌局作廢・公開牌堆",
} as const;

/** 一張牌：card 是 null 就畫牌背 */
export function PlayingCard({
  card,
  size = "md",
  poison = false,
  onClick,
  selected = false,
}: {
  card: string | null;
  size?: "sm" | "md";
  poison?: boolean;
  onClick?: () => void;
  selected?: boolean;
}) {
  const box = size === "sm" ? "h-12 w-[34px] text-[11px]" : "h-[66px] w-12 text-sm";
  const ring = poison ? "ring-2 ring-vermilion ring-offset-1 ring-offset-ink" : selected ? "ring-2 ring-gold ring-offset-1 ring-offset-ink" : "";
  const Tag = onClick ? "button" : "div";
  if (!card) {
    return (
      <Tag
        type={onClick ? "button" : undefined}
        onClick={onClick}
        className={`${box} ${ring} shrink-0 rounded-md border border-vermilion/60 bg-[repeating-linear-gradient(45deg,#5b1a1f_0_4px,#3a0f13_4px_8px)]`}
        aria-label="蓋著的牌"
      />
    );
  }
  const { suit, rank, red } = cardLabel(card);
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`${box} ${ring} relative flex shrink-0 flex-col items-center justify-center rounded-md border border-black/20 bg-[#f4efe6] font-bold leading-none ${
        red ? "text-[#b3261e]" : "text-[#1b1b1b]"
      }`}
      aria-label={`${suit}${rank}${poison ? "（毒牌）" : ""}`}
    >
      <span>{rank}</span>
      <span>{suit}</span>
      {poison ? <span className="absolute -top-2 -right-2 text-base">☠</span> : null}
    </Tag>
  );
}

function CardRow({ cards, size = "md", poison }: { cards: (string | null)[]; size?: "sm" | "md"; poison?: string | null }) {
  if (!cards.length) return <p className="text-xs text-muted">（沒有牌）</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {cards.map((c, i) => (
        <PlayingCard key={`${c ?? "back"}-${i}`} card={c} size={size} poison={Boolean(c && c === poison)} />
      ))}
    </div>
  );
}

/** 疊起來的牌堆：只顯示一張牌背和張數 */
function Pile({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        {count > 1 ? <div className="absolute top-1 left-1"><PlayingCard card={null} /></div> : null}
        <div className="relative">{count ? <PlayingCard card={null} /> : <div className="h-[66px] w-12 rounded-md border border-dashed border-line" />}</div>
      </div>
      <div>
        <div className="text-sm text-paper">{label}</div>
        <div className="text-xs text-muted">{count} 張</div>
      </div>
    </div>
  );
}

function Log({ log }: { log: PokerLogEntry[] }) {
  if (!log.length) return null;
  return (
    <details className="rounded-md border border-line/60 bg-lacquer/60">
      <summary className="cursor-pointer px-3 py-2 text-xs text-muted">牌桌紀錄（{log.length}）：誰在什麼時候洗牌、抽牌</summary>
      <ol className="space-y-0.5 border-t border-line/60 px-3 py-2 text-xs text-paper/85">
        {log
          .slice()
          .reverse()
          .map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <span className="text-muted">{new Date(e.at).toLocaleTimeString("zh-TW")}</span> {e.who}：{e.action}
            </li>
          ))}
      </ol>
    </details>
  );
}

function Result({ player, dealer, name }: { player: string[]; dealer: string[]; name: string }) {
  const r = roundResult(player, dealer);
  const who = r.winner === "tie" ? "平手" : r.winner === "player" ? `${name} 贏` : "陸江遠 贏";
  return (
    <p className="rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold-soft">
      {name} {r.playerTotal} 點 ／ 陸江遠 {r.dealerTotal} 點 → <b>{who}</b>
      <span className="block text-xs text-muted">{r.reason}</span>
    </p>
  );
}

/** 玩家端：線索打開後就是這張牌桌 */
export function PlayerPokerTable({
  poker,
  me,
  busy,
  onOp,
}: {
  poker: PlayerPoker;
  me: string;
  busy: boolean;
  onOp: (op: "shuffle" | "draw" | "stop") => void;
}) {
  const r = poker.round;
  const mine = r?.roleId === me;
  const known = (cards: (string | null)[]) => cards.every((c) => c !== null);

  return (
    <div className="space-y-3">
      <div className="text-xs tracking-[0.2em] text-gold/90">{MODE_TEXT[poker.mode]}</div>

      {poker.mode === "inspect" ? (
        <>
          <p className="text-xs leading-relaxed text-muted">整副牌都翻開給大家驗。覺得有問題可以洗牌；陸江遠開始發牌後就看不到牌面了。</p>
          <CardRow cards={poker.deck} size="sm" />
          <Button size="sm" disabled={busy} onClick={() => onOp("shuffle")}>
            洗牌
          </Button>
        </>
      ) : poker.mode === "deal" ? (
        <>
          <div className="flex flex-wrap gap-5">
            <Pile label="新牌堆" count={poker.deck.length} />
            <Pile label="棄牌堆" count={poker.discard.length} />
          </div>
          {r ? (
            <div className="space-y-2 rounded-lg border border-line bg-lacquer/60 p-3">
              <div className="text-sm text-paper">
                陸江遠 vs {mine ? "你" : r.roleName}
              </div>
              <div>
                <div className="mb-1 text-xs text-muted">陸江遠{r.dealerStop ? "（停止）" : ""}</div>
                <CardRow cards={r.dealer} />
              </div>
              <div>
                <div className="mb-1 text-xs text-muted">
                  {mine ? "你的牌" : r.roleName}
                  {r.playerStop ? "（停止）" : ""}
                  {mine && known(r.player) ? ` · ${total(r.player as string[])} 點` : ""}
                </div>
                <CardRow cards={r.player} />
              </div>
              {r.revealed && known(r.player) && known(r.dealer) ? (
                <Result player={r.player as string[]} dealer={r.dealer as string[]} name={mine ? "你" : r.roleName} />
              ) : mine && !r.playerStop ? (
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => onOp("draw")}>
                    抽牌
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("確定停止嗎？停止後這一局就不能再抽牌。")) onOp("stop");
                    }}
                  >
                    停止
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted">{mine ? "你已經停止，等陸江遠翻牌。" : "等這一局結束。"}</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted">等陸江遠叫下一位上桌。</p>
          )}
        </>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-muted">賭局中斷，這是現場留下的兩個牌堆。</p>
          <div>
            <div className="mb-1 text-sm text-paper">棄牌堆（{poker.discard.length} 張）</div>
            <CardRow cards={poker.discard} size="sm" poison={poker.poison} />
          </div>
          <div>
            <div className="mb-1 text-sm text-paper">新牌堆（{poker.deck.length} 張）</div>
            <CardRow cards={poker.deck} size="sm" poison={poker.poison} />
          </div>
          {poker.poison ? <p className="text-xs text-vermilion-soft">☠ 其中一張牌上貼著「此卡有毒，觸之必死」</p> : null}
        </>
      )}

      <Log log={poker.log} />
    </div>
  );
}

type PokerAct = (body: Record<string, unknown>, done?: string) => Promise<void>;

/** 主持台：撲克牌線索卡片展開後的牌局控制 */
export function HostPokerPanel({
  poker,
  roles,
  busy,
  act,
}: {
  poker: PokerState | null;
  roles: { id: string; name: string }[];
  busy: boolean;
  act: PokerAct;
}) {
  const [pick, setPick] = useState(roles[0]?.id ?? "");
  const [marking, setMarking] = useState(false);
  // 還沒有人動過牌局時，伺服器還沒建立狀態，畫一副新牌
  const p: PokerState = poker ?? { mode: "inspect", deck: freshDeck(), discard: [], round: null, poison: null, log: [] };
  const r = p.round;
  const nameOf = (id: string) => roles.find((x) => x.id === id)?.name ?? id;
  const op = (body: Record<string, unknown>, done: string) => act({ action: "poker", ...body }, done);

  return (
    <div className="space-y-3 rounded-lg border border-gold/30 bg-gold/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs tracking-[0.2em] text-gold/90">牌局：{MODE_TEXT[p.mode]}</span>
        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm("重置牌局？會換一副新牌、清掉所有紀錄。")) void op({ op: "reset" }, "牌局已重置");
          }}
        >
          重置
        </Button>
      </div>

      {p.mode === "inspect" ? (
        <>
          <p className="text-xs leading-relaxed text-muted">
            玩家打開線索就看得到整副牌、可以洗牌（王之喻第一個驗）。大家驗完，你在面前再洗一次，按「開始發牌」牌面就蓋起來。
          </p>
          <CardRow cards={p.deck} size="sm" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => op({ op: "shuffle" }, "已洗牌")}>
              洗牌
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                if (window.confirm("驗牌結束、開始發牌？之後玩家就看不到牌面，也不能再洗牌。")) void op({ op: "deal" }, "開始發牌");
              }}
            >
              開始發牌
            </Button>
          </div>
        </>
      ) : null}

      {p.mode === "deal" ? (
        <>
          {r ? (
            <div className="space-y-2 rounded-lg border border-line bg-lacquer/60 p-3">
              <div className="text-sm text-paper">陸江遠 vs {nameOf(r.roleId)}</div>
              <div>
                <div className="mb-1 text-xs text-muted">
                  陸江遠（你）· {total(r.dealer)} 點{r.dealerStop ? "（停止）" : ""}
                </div>
                <CardRow cards={r.dealer} />
              </div>
              <div>
                <div className="mb-1 text-xs text-muted">
                  {nameOf(r.roleId)} · {total(r.player)} 點{r.playerStop ? "（停止）" : "（在手機上抽牌／停止）"}
                </div>
                <CardRow cards={r.player} />
              </div>
              {r.revealed ? <Result player={r.player} dealer={r.dealer} name={nameOf(r.roleId)} /> : null}
              <div className="flex flex-wrap gap-2">
                {!r.revealed && !r.dealerStop ? (
                  <>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => op({ op: "dealerDraw" }, "莊家抽一張")}>
                      莊家抽牌
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => op({ op: "dealerStop" }, "莊家停止")}>
                      莊家停止
                    </Button>
                  </>
                ) : null}
                {!r.revealed ? (
                  <Button size="sm" disabled={busy} onClick={() => op({ op: "reveal" }, "翻牌比點")}>
                    翻牌比點
                  </Button>
                ) : null}
                <Button size="sm" variant={r.revealed ? "primary" : "ghost"} disabled={busy} onClick={() => op({ op: "collect" }, "已收進棄牌堆")}>
                  收進棄牌堆
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                className="rounded-md border border-line bg-lacquer px-2 py-1.5 text-xs text-paper"
                aria-label="上桌的玩家"
              >
                {roles.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <Button size="sm" disabled={busy || !pick} onClick={() => op({ op: "round", roleId: pick }, `和${nameOf(pick)}開一局`)}>
                開一局（發起始牌）
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => op({ op: "shuffle" }, "新牌堆已洗")}>
                洗新牌堆
              </Button>
            </div>
          )}

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-sm text-paper">新牌堆（{p.deck.length} 張，玩家看不到牌面）</span>
              {!r ? (
                <Button size="sm" variant={marking ? "primary" : "ghost"} disabled={busy} onClick={() => setMarking((m) => !m)}>
                  {marking ? "取消" : "貼毒牌標記"}
                </Button>
              ) : null}
            </div>
            {marking ? <p className="mb-1 text-xs text-gold-soft">點一張牌貼上「此卡有毒，觸之必死」——牌局作廢，玩家端改成公開棄牌堆與新牌堆。</p> : null}
            <div className="flex flex-wrap gap-1.5">
              {p.deck.map((c) => (
                <PlayingCard
                  key={c}
                  card={c}
                  size="sm"
                  onClick={
                    marking
                      ? () => {
                          if (window.confirm(`在 ${cardLabel(c).suit}${cardLabel(c).rank} 貼上毒牌標記？`)) {
                            setMarking(false);
                            void op({ op: "poison", card: c }, "已貼上毒牌標記，玩家端公開牌堆");
                          }
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-sm text-paper">棄牌堆（{p.discard.length} 張）</div>
            <CardRow cards={p.discard} size="sm" />
          </div>
        </>
      ) : null}

      {p.mode === "reveal" ? (
        <>
          <p className="text-xs leading-relaxed text-muted">玩家端現在看得到這兩個牌堆，毒牌標出來了。接手冊 Step7 牌局兇案。</p>
          <div>
            <div className="mb-1 text-sm text-paper">棄牌堆（{p.discard.length} 張）</div>
            <CardRow cards={p.discard} size="sm" poison={p.poison} />
          </div>
          <div>
            <div className="mb-1 text-sm text-paper">新牌堆（{p.deck.length} 張）</div>
            <CardRow cards={p.deck} size="sm" poison={p.poison} />
          </div>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => op({ op: "unpoison" }, "已撤掉毒牌標記")}>
            撤掉毒牌標記（回到發牌）
          </Button>
        </>
      ) : null}

      <Log log={p.log} />
    </div>
  );
}
