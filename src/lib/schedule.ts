// Playback is driven by an ordered list of speak steps. (This indirection keeps
// the door open for non-linear playlists later; for now it's simply linear.)
export type Step = { type: "speak"; index: number };

/** Straight-through reading of every segment. */
export function linearSchedule(count: number): Step[] {
  const steps: Step[] = [];
  for (let i = 0; i < count; i++) steps.push({ type: "speak", index: i });
  return steps;
}

/** Lowest segment index referenced by a schedule (generation start point). */
export function minSpeakIndex(steps: Step[]): number {
  let min = Infinity;
  for (const s of steps) min = Math.min(min, s.index);
  return min === Infinity ? 0 : min;
}
