"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export interface TabDef {
  id: string;
  label: string;
  /** 用漢字當圖示，比 emoji 更貼近整體風格 */
  glyph: string;
  /** 右上角的紅點數字，例如待判定的舉報數 */
  badge?: number;
}

/**
 * 手機版固定外殼。
 *
 * 整頁不捲動：header 與底部導覽列固定，只有中間內容區自己捲。
 * 這樣導覽列永遠在拇指構得到的位置，也不會被虛擬鍵盤或長列表推走。
 */
export function AppShell({
  header,
  children,
  footer,
  tabs,
  active,
  onTabChange,
}: {
  header: ReactNode;
  children: ReactNode;
  /** 固定在導覽列上方的操作區（例如主持台的調配按鈕） */
  footer?: ReactNode;
  tabs: TabDef[];
  active: string;
  onTabChange: (id: string) => void;
}) {
  return (
    <div className="app-shell mx-auto w-full max-w-lg">
      <header className="shrink-0 border-b border-line/60 bg-lacquer/90 px-4 py-2.5 backdrop-blur">
        {header}
      </header>

      <div className="app-scroll px-4 py-3">{children}</div>

      {footer ? (
        <div className="shrink-0 border-t border-line/60 bg-lacquer/95 px-4 py-2.5 backdrop-blur">
          {footer}
        </div>
      ) : null}

      <nav className="safe-bottom shrink-0 border-t border-line bg-panel/95 backdrop-blur">
        <ul className="flex">
          {tabs.map((t) => {
            const on = t.id === active;
            return (
              <li key={t.id} className="flex-1">
                <button
                  type="button"
                  onClick={() => onTabChange(t.id)}
                  aria-current={on ? "page" : undefined}
                  className={`flex w-full flex-col items-center gap-0.5 py-2 transition-colors ${
                    on ? "text-gold-soft" : "text-muted/70 hover:text-paper/80"
                  }`}
                >
                  <span className="relative">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-md border text-base font-bold ${
                        on ? "border-gold/60 bg-gold/12" : "border-transparent"
                      }`}
                    >
                      {t.glyph}
                    </span>
                    {t.badge ? (
                      <span className="tabular absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-vermilion px-1 text-[10px] font-bold text-paper">
                        {t.badge > 9 ? "9+" : t.badge}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[11px]">{t.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/** 外殼 header 內用的精簡標題列 */
export function ShellHeader({
  title,
  subtitle,
  right,
  backHref,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  backHref?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {backHref ? (
        <Link
          href={backHref}
          className="shrink-0 text-lg leading-none text-muted transition-colors hover:text-gold"
          aria-label="返回"
        >
          ←
        </Link>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 truncate text-base font-bold text-paper">
          {title}
        </div>
        {subtitle ? (
          <div className="mt-0.5 truncate text-xs text-muted">{subtitle}</div>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

/** 分頁內的區塊標題，比 PanelTitle 更精簡，省垂直空間 */
export function SectionTitle({
  children,
  extra,
}: {
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-xs font-bold tracking-[0.25em] text-gold/85">{children}</h2>
      {extra}
    </div>
  );
}
