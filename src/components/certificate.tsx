"use client";

import { ORGANIZATION_NAME } from "@/lib/config";
import type { Certificate as CertificateData } from "@/lib/types";

/**
 * 會長就任聘書。
 *
 * 刻意做成淺色紙張質感，在整體暗色介面中跳出來——這是遊戲最後的獎狀，
 * 值得跟其他面板不一樣。
 */
export function Certificate({ cert }: { cert: CertificateData }) {
  // 直接拆字串，不進 Date——"2026-09-10" 會被當成 UTC 午夜，在 UTC 以西的時區會少一天
  const [y, m, d] = cert.date.split("-");
  const dateText = y && m && d ? `${y} 年 ${m} 月 ${d} 日` : "";

  return (
    <div className="rounded-lg bg-[#f3ead6] p-2 shadow-[0_8px_30px_-10px_rgba(0,0,0,0.8)]">
      <div className="rounded border-[3px] border-double border-[#b8985c] px-5 py-6 text-center">
        <p className="text-2xl font-bold tracking-[0.4em] text-[#c0642c]">聘 書</p>
        <div className="mx-auto mt-2 h-px w-24 bg-[#b8985c]" />

        <p className="mt-6 text-left text-base leading-loose text-[#3a2f22]">
          茲任命
          <span className="mx-1.5 border-b-2 border-[#3a2f22] px-1.5 font-bold whitespace-nowrap">
            {cert.nickname}
          </span>
          擔任{ORGANIZATION_NAME}
          <span className="mx-1.5 border-b-2 border-[#3a2f22] px-1.5 font-bold whitespace-nowrap">
            {cert.position}
          </span>
          一職。同時授予稱號：
        </p>

        <p className="mt-5 text-2xl leading-snug font-bold tracking-wide text-[#c0642c]">
          {cert.title}
        </p>

        <div className="mt-6 flex items-end justify-between text-xs text-[#6b5a44]">
          <span>
            扮演角色　<b className="text-[#3a2f22]">{cert.characterName}</b>
          </span>
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-[#c0392b]/70 text-[10px] leading-tight font-bold text-[#c0392b]/80">
            海星南洋
            <br />
            中華商會
          </span>
        </div>
        <p className="mt-1 text-left text-xs text-[#6b5a44]">{dateText}</p>
      </div>
    </div>
  );
}
