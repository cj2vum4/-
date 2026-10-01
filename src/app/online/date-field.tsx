"use client";

import { Field } from "@/components/ui";

/** 場次號碼輸入框：8 位數字的日期（例如 20261001），只收數字 */
export function DateCodeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field
      label="場次號碼（遊戲日期）"
      hint="8 位數字，例如 2026 年 10 月 1 日就是 20261001。"
      placeholder="20261001"
      inputMode="numeric"
      maxLength={8}
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 8))}
      className="tabular tracking-widest"
    />
  );
}
