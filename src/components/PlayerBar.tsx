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
};

export function PlayerBar({
  isPlaying,
  buffering,
  generating,
  canPlay,
  speed,
  voice,
  onToggle,
  onPrev,
  onNext,
  onSpeed,
  onVoice,
}: {
  isPlaying: boolean;
  buffering: boolean;
  generating: boolean;
  canPlay: boolean;
  speed: number;
  voice: string;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSpeed: (x: number) => void;
  onVoice: (id: string) => void;
}) {
  return (
    <div className="sticky bottom-0 z-10 border-t border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-4 px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={onPrev}
            disabled={!canPlay}
            aria-label="Previous sentence"
            className="rounded-md p-2 text-muted hover:bg-bg hover:text-text disabled:opacity-40"
          >
            <Icon path={ICONS.prev} />
          </button>
          <button
            onClick={onToggle}
            disabled={!canPlay}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-bg transition-colors hover:bg-accent-bright disabled:opacity-40"
          >
            <Icon path={isPlaying ? ICONS.pause : ICONS.play} />
          </button>
          <button
            onClick={onNext}
            disabled={!canPlay}
            aria-label="Next sentence"
            className="rounded-md p-2 text-muted hover:bg-bg hover:text-text disabled:opacity-40"
          >
            <Icon path={ICONS.next} />
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

        <div className="w-full font-mono text-xs text-muted sm:w-auto">
          {generating
            ? "generating…"
            : buffering
              ? "buffering…"
              : isPlaying
                ? "playing"
                : canPlay
                  ? "paused"
                  : "idle"}
        </div>
      </div>
    </div>
  );
}
