import type { Block, BlockKind } from "./extract";

// Each segment becomes exactly one Kokoro generate() call, so audio boundaries
// match displayed sentences exactly and every segment has a STABLE index
// (needed for resume, bookmarks, sections, and gapless preloading).

export type SegmentKind = BlockKind; // "heading" | "text" | "code" | "table"

export type Segment = {
  index: number;
  text: string; // display text
  kind: SegmentKind;
  section: number;
};

function splitSentences(paragraph: string): string[] {
  const matches = paragraph.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g);
  return (matches ?? [paragraph]).map((s) => s.trim()).filter(Boolean);
}

export function segment(blocks: Block[]): Segment[] {
  const segs: Omit<Segment, "index">[] = [];
  let section = 0;
  let sawContent = false;

  for (const block of blocks) {
    if (block.kind === "heading") {
      if (sawContent) section++;
      segs.push({ text: block.text, kind: "heading", section });
      sawContent = false;
      continue;
    }
    if (block.kind === "code" || block.kind === "table") {
      segs.push({ text: block.text, kind: block.kind, section });
      sawContent = true;
      continue;
    }
    for (const s of splitSentences(block.text)) {
      segs.push({ text: s, kind: "text", section });
      sawContent = true;
    }
  }

  return segs.map((s, index) => ({ ...s, index }));
}

/** First segment index of the previous/next section relative to `from`. */
export function sectionJump(segs: Segment[], from: number, dir: 1 | -1): number {
  if (segs.length === 0) return 0;
  const cur = segs[Math.max(0, Math.min(from, segs.length - 1))]?.section ?? 0;
  const idx = segs.findIndex((s) => s.section === cur + dir);
  if (idx >= 0) return idx;
  return dir > 0 ? segs.length - 1 : 0;
}
