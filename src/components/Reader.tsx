import { useEffect, useMemo, useRef } from "react";
import type { Segment } from "../lib/segment";
import { activeWordIndex, estimateWords } from "../lib/words";

type Group =
  | { type: "heading"; seg: Segment }
  | { type: "code"; seg: Segment }
  | { type: "table"; seg: Segment }
  | { type: "para"; items: Segment[] };

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
    return <p className="text-muted">Load a PDF or Markdown file to see its text here.</p>;
  }

  // Build render groups: headings / code / table stand alone; runs of text
  // sentences flow together into a paragraph.
  const groups: Group[] = [];
  for (const seg of segments) {
    if (seg.kind === "heading") groups.push({ type: "heading", seg });
    else if (seg.kind === "code") groups.push({ type: "code", seg });
    else if (seg.kind === "table") groups.push({ type: "table", seg });
    else {
      const last = groups[groups.length - 1];
      if (last && last.type === "para") last.items.push(seg);
      else groups.push({ type: "para", items: [seg] });
    }
  }

  const refFor = (i: number) => (i === currentSentence ? activeRef : undefined);

  return (
    <div className="font-sans text-[1.15rem] leading-9">
      {groups.map((g, gi) => {
        if (g.type === "heading") {
          return (
            <Piece
              key={gi}
              seg={g.seg}
              variant="heading"
              active={g.seg.index === currentSentence}
              ready={durations[g.seg.index] != null}
              duration={durations[g.seg.index] ?? 2}
              currentTime={currentTime}
              onClick={() => onSentenceClick(g.seg.index)}
              activeRef={refFor(g.seg.index)}
            />
          );
        }
        if (g.type === "code" || g.type === "table") {
          return (
            <SkippedBlock
              key={gi}
              seg={g.seg}
              active={g.seg.index === currentSentence}
              onClick={() => onSentenceClick(g.seg.index)}
              activeRef={refFor(g.seg.index)}
            />
          );
        }
        return (
          <p key={gi} className="mb-5">
            {g.items.map((seg) => (
              <Piece
                key={seg.index}
                seg={seg}
                variant="text"
                active={seg.index === currentSentence}
                ready={durations[seg.index] != null}
                duration={durations[seg.index] ?? 3}
                currentTime={seg.index === currentSentence ? currentTime : 0}
                onClick={() => onSentenceClick(seg.index)}
                activeRef={refFor(seg.index)}
              />
            ))}
          </p>
        );
      })}
    </div>
  );
}

function SkippedBlock({
  seg,
  active,
  onClick,
  activeRef,
}: {
  seg: Segment;
  active: boolean;
  onClick: () => void;
  activeRef?: React.Ref<HTMLElement>;
}) {
  const label = seg.kind === "code" ? "code block" : "table";
  return (
    <div
      ref={activeRef as React.Ref<HTMLDivElement>}
      onClick={onClick}
      className={`mb-5 cursor-pointer rounded-md border px-3 py-2 ${
        active
          ? "border-accent-bright/50 bg-accent/10"
          : "border-border bg-bg/40"
      }`}
      title="Announced and skipped while reading"
    >
      <span className="font-mono text-xs uppercase tracking-wide text-accent">
        {label} · skipped
      </span>
      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted">
        {seg.text.slice(0, 500)}
      </pre>
    </div>
  );
}

function Piece({
  seg,
  active,
  ready,
  variant,
  duration,
  currentTime,
  onClick,
  activeRef,
}: {
  seg: Segment;
  active: boolean;
  ready: boolean;
  variant: "heading" | "text";
  duration: number;
  currentTime: number;
  onClick: () => void;
  activeRef?: React.Ref<HTMLElement>;
}) {
  const heading = variant === "heading";
  const words = useMemo(
    () => (active ? estimateWords(seg.text, Math.max(0.1, duration)) : []),
    [active, seg.text, duration],
  );
  const wi = active ? activeWordIndex(words, currentTime) : -1;

  const base = heading
    ? "block font-mono text-sm font-semibold uppercase tracking-wide text-accent mb-1 mt-2"
    : "";
  const tone = active ? "text-text" : ready ? "text-text/85" : "text-muted/55";

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
      className={`${base} cursor-pointer rounded bg-accent/10 px-0.5 font-medium text-text underline decoration-accent/40 decoration-2 underline-offset-4`}
    >
      {words.map((w, i) => (
        <span
          key={i}
          className={i === wi ? "rounded bg-accent-bright/25 text-accent-bright" : undefined}
        >
          {w.text}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
      {!heading ? " " : ""}
    </span>
  );
}
