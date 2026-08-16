import { useEffect, useMemo, useRef } from "react";
import type { Segment } from "../lib/segment";
import { activeWordIndex, estimateWords } from "../lib/words";

export function Reader({
  segments,
  durations,
  currentSentence,
  currentTime,
  onSentenceClick,
}: {
  segments: Segment[];
  durations: number[];
  currentSentence: number;
  currentTime: number;
  onSentenceClick: (i: number) => void;
}) {
  const activeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentSentence]);

  if (segments.length === 0) {
    return (
      <p className="text-muted">
        Load a PDF or Markdown file to see its text here.
      </p>
    );
  }

  // Group consecutive sentences into paragraph blocks split by headings.
  const blocks: { heading?: Segment; items: Segment[] }[] = [];
  for (const seg of segments) {
    if (seg.isHeading) {
      blocks.push({ heading: seg, items: [] });
    } else {
      if (blocks.length === 0) blocks.push({ items: [] });
      blocks[blocks.length - 1].items.push(seg);
    }
  }

  return (
    <div className="font-sans text-[1.15rem] leading-9">
      {blocks.map((block, bi) => (
        <div key={bi} className="mb-5">
          {block.heading && (
            <Piece
              seg={block.heading}
              heading
              active={block.heading.index === currentSentence}
              ready={durations[block.heading.index] != null}
              duration={durations[block.heading.index] ?? 2}
              currentTime={currentTime}
              onClick={() => onSentenceClick(block.heading!.index)}
              activeRef={
                block.heading.index === currentSentence ? activeRef : undefined
              }
            />
          )}
          <p>
            {block.items.map((seg) => (
              <Piece
                key={seg.index}
                seg={seg}
                active={seg.index === currentSentence}
                ready={durations[seg.index] != null}
                duration={durations[seg.index] ?? 3}
                currentTime={seg.index === currentSentence ? currentTime : 0}
                onClick={() => onSentenceClick(seg.index)}
                activeRef={seg.index === currentSentence ? activeRef : undefined}
              />
            ))}
          </p>
        </div>
      ))}
    </div>
  );
}

function Piece({
  seg,
  active,
  ready,
  heading,
  duration,
  currentTime,
  onClick,
  activeRef,
}: {
  seg: Segment;
  active: boolean;
  ready: boolean;
  heading?: boolean;
  duration: number;
  currentTime: number;
  onClick: () => void;
  activeRef?: React.Ref<HTMLElement>;
}) {
  const words = useMemo(
    () => (active ? estimateWords(seg.text, Math.max(0.1, duration)) : []),
    [active, seg.text, duration],
  );
  const wi = active ? activeWordIndex(words, currentTime) : -1;

  const base = heading
    ? "block font-mono text-sm font-semibold uppercase tracking-wide text-accent mb-1"
    : "";
  const tone = active
    ? "text-text"
    : ready
      ? "text-text/85"
      : "text-muted/55"; // not yet generated

  if (!active) {
    return (
      <span
        ref={activeRef as React.Ref<HTMLSpanElement>}
        onClick={onClick}
        className={`${base} ${tone} cursor-pointer rounded px-0.5 transition-colors hover:bg-surface`}
        title="Click to play from here"
      >
        {seg.text}
        {!heading ? " " : ""}
      </span>
    );
  }

  return (
    <span
      ref={activeRef as React.Ref<HTMLSpanElement>}
      onClick={onClick}
      // Reliable layer = sentence highlight (color + underline + weight, never
      // color alone). Word tint on top is the estimated enhancement.
      className={`${base} cursor-pointer rounded bg-accent/10 px-0.5 font-medium text-text underline decoration-accent/40 decoration-2 underline-offset-4`}
    >
      {words.map((w, i) => (
        <span
          key={i}
          className={
            i === wi ? "rounded bg-accent-bright/25 text-accent-bright" : undefined
          }
        >
          {w.text}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
      {!heading ? " " : ""}
    </span>
  );
}
