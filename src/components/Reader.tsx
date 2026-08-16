import { useEffect, useMemo, useRef } from "react";
import type { Sentence } from "../hooks/useTts";
import { activeWordIndex, estimateWords } from "../lib/words";

export function Reader({
  sentences,
  previewText,
  currentSentence,
  currentTime,
  onSentenceClick,
}: {
  sentences: Sentence[];
  previewText: string;
  currentSentence: number;
  currentTime: number;
  onSentenceClick: (i: number) => void;
}) {
  const activeRef = useRef<HTMLSpanElement | null>(null);

  // Keep the active sentence scrolled into view.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentSentence]);

  if (sentences.length === 0) {
    return (
      <div className="whitespace-pre-wrap font-sans text-[1.05rem] leading-8 text-muted">
        {previewText || (
          <span className="text-muted">
            Load a PDF or Markdown file to see its text here.
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="font-sans text-[1.15rem] leading-9">
      {sentences.map((s) => (
        <SentenceView
          key={s.index}
          sentence={s}
          active={s.index === currentSentence}
          currentTime={s.index === currentSentence ? currentTime : 0}
          onClick={() => onSentenceClick(s.index)}
          activeRef={s.index === currentSentence ? activeRef : undefined}
        />
      ))}
    </div>
  );
}

function SentenceView({
  sentence,
  active,
  currentTime,
  onClick,
  activeRef,
}: {
  sentence: Sentence;
  active: boolean;
  currentTime: number;
  onClick: () => void;
  activeRef?: React.Ref<HTMLSpanElement>;
}) {
  const words = useMemo(
    () => (active ? estimateWords(sentence.text, sentence.duration) : []),
    [active, sentence.text, sentence.duration],
  );
  const wi = active ? activeWordIndex(words, currentTime) : -1;

  if (!active) {
    return (
      <span
        onClick={onClick}
        className="cursor-pointer rounded px-0.5 text-text/80 transition-colors hover:bg-surface"
        title="Click to play from here"
      >
        {sentence.text}{" "}
      </span>
    );
  }

  return (
    <span
      ref={activeRef}
      onClick={onClick}
      // Active-sentence highlight is the reliable layer: color + underline +
      // weight (never color alone, for accessibility).
      className="cursor-pointer rounded bg-accent/10 px-0.5 font-medium text-text underline decoration-accent/40 decoration-2 underline-offset-4"
    >
      {words.map((w, i) => (
        <span
          key={i}
          className={
            i === wi
              ? "rounded bg-accent-bright/25 text-accent-bright"
              : undefined
          }
        >
          {w.text}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}{" "}
    </span>
  );
}
