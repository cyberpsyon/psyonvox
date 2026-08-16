// Kokoro emits no word-level timestamps, so current-word tracking is ESTIMATED:
// we allocate a sentence's known audio duration across its words in proportion
// to each word's character length (a decent proxy for spoken length). Sentence
// highlighting is the exact/reliable layer; this sits on top as an enhancement.

export type Word = {
  text: string;
  start: number; // char offset within the sentence
  end: number; // char offset within the sentence (exclusive)
  tStart: number; // seconds
  tEnd: number; // seconds
};

const WORD_RE = /\S+/g;

/** Split a sentence into words with char spans and proportional time spans. */
export function estimateWords(sentence: string, duration: number): Word[] {
  const raw: { text: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  WORD_RE.lastIndex = 0;
  while ((m = WORD_RE.exec(sentence)) !== null) {
    raw.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  if (raw.length === 0) return [];

  // Weight by character count; a minimum weight keeps tiny tokens from getting
  // near-zero time.
  const weights = raw.map((w) => Math.max(1, w.text.length));
  const total = weights.reduce((a, b) => a + b, 0);

  let acc = 0;
  return raw.map((w, i) => {
    const tStart = (acc / total) * duration;
    acc += weights[i];
    const tEnd = (acc / total) * duration;
    return { ...w, tStart, tEnd };
  });
}

/** Index of the active word at time `t`, or -1 if before the first word. */
export function activeWordIndex(words: Word[], t: number): number {
  if (words.length === 0) return -1;
  for (let i = 0; i < words.length; i++) {
    if (t < words[i].tEnd) return i;
  }
  return words.length - 1;
}
