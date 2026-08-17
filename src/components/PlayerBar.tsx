import { VoicePicker } from "./VoicePicker";

function Icon({ path }: { path: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  play: "M8 5v14l11-7z",
  pause: "M6 5h4v14H6zM14 5h4v14h-4z",
  prev: "M6 6h2v12H6zm3.5 6l8.5 6V6z",
  next: "M16 6h2v12h-2zM6 18l8.5-6L6 6z",
  rewind:
    "M12.5 8V5l-5 4 5 4v-3c2.76 0 5 2.24 5 5s-2.24 5-5 5-5-2.24-5-5H5.5c0 3.87 3.13 7 7 7s7-3.13 7-7-3.13-7-7-7z",
  sectionPrev: "M6 6h2v12H6zm12 0v12l-8-6z",
  sectionNext: "M16 6h2v12h-2zM6 6l8 6-8 6z",
};

export function PlayerBar({
  isPlaying,
  buffering,
  generating,
  canPlay,
  speed,
  voice,
  currentSentence,
  total,
  onToggle,
  onPrev,
  onNext,
  onPrevSection,
  onNextSection,
  onRewind,
  onSpeed,
  onVoice,
}: {
  isPlaying: boolean;
  buffering: boolean;
  generating: boolean;
  canPlay: boolean;
  speed: number;
  voice: string;
  currentSentence: number;
  total: number;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onPrevSection: () => void;
  onNextSection: () => void;
  onRewind: () => void;
  onSpeed: (x: number) => void;
  onVoice: (id: string) => void;
}) {
  const pct =
    total > 0 && currentSentence >= 0
      ? Math.round(((currentSentence + 1) / total) * 100)
      : 0;
  return (
    <div className="sticky bottom-0 z-10 border-t border-border bg-surface/95 backdrop-blur">
      {total > 0 && (
        <div
          role="progressbar"
          aria-label="Document progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-0.5 w-full bg-bg"
        >
          <div
            className="h-full bg-accent transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-4 px-4 py-3">
        <div className="flex items-center gap-1">
          <button
            onClick={onPrevSection}
            disabled={!canPlay}
            aria-label="Previous section"
            title="Previous section ( [ )"
            className="rounded-md p-2 text-muted hover:bg-bg hover:text-text disabled:opacity-40"
          >
            <Icon path={ICONS.sectionPrev} />
          </button>
          <button
            onClick={onRewind}
            disabled={!canPlay}
            aria-label="Rewind 10 seconds"
            title="Rewind 10s ( R )"
            className="rounded-md p-2 text-muted hover:bg-bg hover:text-text disabled:opacity-40"
          >
            <Icon path={ICONS.rewind} />
          </button>
          <button
            onClick={onPrev}
            disabled={!canPlay}
            aria-label="Previous sentence"
            title="Previous sentence ( ← )"
            className="rounded-md p-2 text-muted hover:bg-bg hover:text-text disabled:opacity-40"
          >
            <Icon path={ICONS.prev} />
          </button>
          <button
            onClick={onToggle}
            disabled={!canPlay}
            aria-label={isPlaying ? "Pause" : "Play"}
            title="Play / Pause ( Space )"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-bg transition-colors hover:bg-accent-bright disabled:opacity-40"
          >
            <Icon path={isPlaying ? ICONS.pause : ICONS.play} />
          </button>
          <button
            onClick={onNext}
            disabled={!canPlay}
            aria-label="Next sentence"
            title="Next sentence ( → )"
            className="rounded-md p-2 text-muted hover:bg-bg hover:text-text disabled:opacity-40"
          >
            <Icon path={ICONS.next} />
          </button>
          <button
            onClick={onNextSection}
            disabled={!canPlay}
            aria-label="Next section"
            title="Next section ( ] )"
            className="rounded-md p-2 text-muted hover:bg-bg hover:text-text disabled:opacity-40"
          >
            <Icon path={ICONS.sectionNext} />
          </button>
        </div>

        <div className="flex min-w-[180px] flex-1 items-center gap-3">
          <span className="w-10 font-mono text-xs text-muted">
            {speed.toFixed(2)}×
          </span>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={speed}
            onChange={(e) => onSpeed(Number(e.target.value))}
            className="flex-1"
            aria-label="Playback speed"
          />
        </div>

        <VoicePicker value={voice} onChange={onVoice} />

        <div className="flex w-full items-center gap-3 font-mono text-xs text-muted sm:w-auto">
          {total > 0 && currentSentence >= 0 && (
            <span className="whitespace-nowrap">
              {(currentSentence + 1).toLocaleString()} / {total.toLocaleString()}
            </span>
          )}
          <span aria-live="polite">
            {generating
              ? "generating…"
              : buffering
                ? "buffering…"
                : isPlaying
                  ? "playing"
                  : canPlay
                    ? "paused"
                    : "idle"}
          </span>
        </div>
      </div>
    </div>
  );
}
