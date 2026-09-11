"use client";

import { useEffect, useState } from "react";
import { ApiError, api, type PlayerIdentity } from "@/lib/client";
import { CHARACTER_MAP } from "@/lib/characters";
import { Notice } from "@/components/ui";

/**
 * 故事復盤的全螢幕檢視。
 *
 * 內容不在前端 bundle 裡——它會揭露全場陣營與所有真相，所以放在伺服器端，
 * 由 `/api/sessions/[code]/story` 在聘書發放後才回傳。這裡點開才去拿。
 */

interface StoryBlock {
  heading?: string;
  paragraphs: string[];
  characterId?: string;
}
interface StoryChapter {
  id: string;
  title: string;
  blocks: StoryBlock[];
}
interface StoryData {
  title: string;
  subtitle: string;
  chapters: StoryChapter[];
  epilogue: string;
}

export function StoryView({
  code,
  me,
  myCharacterId,
  onClose,
}: {
  code: string;
  me: PlayerIdentity;
  /** 用來標出「這是你扮演的角色」 */
  myCharacterId?: string;
  onClose: () => void;
}) {
  const [story, setStory] = useState<StoryData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<StoryData>(`/api/sessions/${code}/story`, { player: me })
      .then((d) => alive && setStory(d))
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : "讀取故事失敗");
      });
    return () => {
      alive = false;
    };
  }, [code, me]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-lacquer">
      <header className="safe-top shrink-0 border-b border-line bg-lacquer/95 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-sm text-muted hover:text-gold"
            aria-label="關閉故事復盤"
          >
            ← 返回
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold text-gold-soft">
              {story?.title ?? "陣營部分復盤"}
            </h1>
            {story ? (
              <p className="truncate text-[11px] text-muted/70">{story.subtitle}</p>
            ) : null}
          </div>
        </div>
      </header>

      <div className="app-scroll px-4 py-4">
        {error ? <Notice>{error}</Notice> : null}
        {!story && !error ? (
          <p className="py-10 text-center text-sm text-muted">展卷中…</p>
        ) : null}

        {story?.chapters.map((chapter) => (
          <section key={chapter.id} className="mb-7">
            <h2 className="mb-3 flex items-center gap-2">
              <span className="h-px flex-1 bg-line" />
              <span className="shrink-0 text-sm font-bold tracking-[0.3em] text-gold">
                {chapter.title}
              </span>
              <span className="h-px flex-1 bg-line" />
            </h2>

            {chapter.blocks.map((block, i) => {
              const mine = Boolean(block.characterId && block.characterId === myCharacterId);
              const character = block.characterId ? CHARACTER_MAP[block.characterId] : undefined;
              return (
                <article
                  key={`${chapter.id}-${i}`}
                  className={`mb-4 rounded-lg border px-3.5 py-3 ${
                    mine ? "border-gold/50 bg-gold/8" : "border-line/70 bg-panel-2/40"
                  }`}
                >
                  {block.heading ? (
                    <h3
                      className={`mb-2 flex flex-wrap items-center gap-2 text-sm font-bold ${
                        mine ? "text-gold-soft" : "text-paper"
                      }`}
                    >
                      {block.heading}
                      {mine ? (
                        <span className="rounded border border-gold/60 bg-gold/15 px-1.5 py-0.5 text-[10px] font-normal text-gold-soft">
                          你扮演的角色
                        </span>
                      ) : null}
                    </h3>
                  ) : null}

                  {character?.poster && mine ? (
                    <p className="mb-2 text-[11px] text-muted/70">{character.occupation}</p>
                  ) : null}

                  {block.paragraphs.map((text, j) => (
                    <p
                      key={j}
                      className="mb-2 text-[13px] leading-[1.9] text-paper/85 last:mb-0"
                    >
                      {text}
                    </p>
                  ))}
                </article>
              );
            })}
          </section>
        ))}

        {story ? (
          <p className="mb-6 rounded-lg border border-vermilion/40 bg-vermilion/8 px-3.5 py-3 text-[13px] leading-[1.9] text-vermilion-soft">
            {story.epilogue}
          </p>
        ) : null}
      </div>
    </div>
  );
}
