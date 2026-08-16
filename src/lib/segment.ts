// Deterministic, up-front segmentation. Each segment becomes exactly one
// Kokoro generate() call, so audio boundaries match displayed sentences exactly
// and every segment has a STABLE index (needed for resume, bookmarks, sections,
// and gapless preloading). Headings start new sections.

export type Segment = {
  index: number;
  text: string;
  isHeading: boolean;
  section: number;
};

const HEADING_MAX_LEN = 64;
const HEADING_MAX_WORDS = 10;

function isHeading(line: string): boolean {
  if (line.length > HEADING_MAX_LEN) return false;
  if (!/[A-Za-z]/.test(line)) return false;
  if (/[.!?]$/.test(line)) return false; // sentences end in terminal punctuation
  const words = line.split(/\s+/).length;
  if (words > HEADING_MAX_WORDS) return false;
  // Numbered/section-style headings, ALL CAPS, or Title Case short lines.
  if (/^\d+(\.\d+)*\s+\S/.test(line)) return true;
  if (line === line.toUpperCase()) return true;
  if (words <= HEADING_MAX_WORDS) return true;
  return false;
}

function splitSentences(paragraph: string): string[] {
  const matches = paragraph.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g);
  return (matches ?? [paragraph]).map((s) => s.trim()).filter(Boolean);
}

export function segment(text: string): Segment[] {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const segs: Omit<Segment, "index">[] = [];
  let section = 0;
  let sawContent = false;

  for (const line of lines) {
    if (isHeading(line)) {
      if (sawContent) section++;
      segs.push({ text: line, isHeading: true, section });
      sawContent = false;
      continue;
    }
    for (const s of splitSentences(line)) {
      segs.push({ text: s, isHeading: false, section });
      sawContent = true;
    }
  }

  return segs.map((s, index) => ({ ...s, index }));
}

/** First segment index of the previous/next section relative to `from`. */
export function sectionJump(
  segs: Segment[],
  from: number,
  dir: 1 | -1,
): number {
  if (segs.length === 0) return 0;
  const cur = segs[Math.max(0, Math.min(from, segs.length - 1))]?.section ?? 0;
  const targetSection = cur + dir;
  const idx = segs.findIndex((s) => s.section === targetSection);
  if (idx >= 0) return idx;
  return dir > 0 ? segs.length - 1 : 0;
}
