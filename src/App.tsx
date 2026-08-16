import { useCallback, useEffect, useRef, useState } from "react";
import { useTts } from "./hooks/useTts";
import { extractFile } from "./lib/extract";
import {
  approxDownloadMB,
  probeWebGPU,
  resolvePair,
  type DevicePreference,
} from "./lib/device";
import { Reader } from "./components/Reader";
import { PlayerBar } from "./components/PlayerBar";

export default function App() {
  const tts = useTts();
  const [pref, setPref] = useState<DevicePreference>("auto");
  const [fileName, setFileName] = useState("");
  const [docText, setDocText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [webgpu, setWebgpu] = useState(false);

  // Real capability probe — navigator.gpu can exist without a working adapter.
  useEffect(() => {
    let alive = true;
    void probeWebGPU().then((ok) => alive && setWebgpu(ok));
    return () => {
      alive = false;
    };
  }, []);

  const resolved = resolvePair(pref, webgpu);
  const canPlay = tts.sentences.length > 0;

  const onFile = useCallback(async (file: File) => {
    setFileError(null);
    setScanned(false);
    setExtracting(true);
    setFileName(file.name);
    try {
      const res = await extractFile(file);
      setDocText(res.text);
      if (res.likelyScanned) setScanned(true);
    } catch (err) {
      setFileError((err as Error).message ?? "Could not read that file.");
      setDocText("");
    } finally {
      setExtracting(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files?.[0];
      if (f) void onFile(f);
    },
    [onFile],
  );

  // ---- keyboard shortcuts ----
  const { toggle, seekToSentence, currentSentence } = tts;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA")
        return;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        seekToSentence(Math.max(0, currentSentence) + 1);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        seekToSentence(Math.max(0, currentSentence - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, seekToSentence, currentSentence]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-surface/60">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="font-mono text-xl font-semibold tracking-tight">
              <span className="text-accent">Psyon</span>
              <span className="text-text">Vox</span>
            </h1>
            <p className="text-xs text-muted">
              Reads your documents aloud — 100% in your browser. Files never leave
              your device.
            </p>
          </div>
          <EngineBadge
            ready={tts.phase === "ready"}
            device={resolved.device}
            dtype={resolved.dtype}
          />
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        {/* Model / engine panel */}
        {tts.phase !== "ready" && (
          <section className="mb-6 rounded-lg border border-border bg-surface p-4">
            <h2 className="mb-1 text-sm font-semibold">Voice model</h2>
            <p className="mb-3 text-sm text-muted">
              First load downloads the Kokoro-82M model (~{approxDownloadMB(resolved)} MB)
              once, then it's cached on this device.{" "}
              {webgpu
                ? "WebGPU detected."
                : "WebGPU not detected — using the wasm path."}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted">Engine</span>
                <select
                  value={pref}
                  disabled={tts.phase === "loading-model"}
                  onChange={(e) => setPref(e.target.value as DevicePreference)}
                  className="rounded-md border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent disabled:opacity-50"
                >
                  <option value="auto">Auto {webgpu ? "(WebGPU)" : "(wasm)"}</option>
                  <option value="webgpu">WebGPU · fp32 · ~330 MB</option>
                  <option value="wasm">wasm · q8 · ~90 MB</option>
                  <option value="wasm-lite">wasm lite · q4 · ~45 MB</option>
                </select>
              </label>
              <button
                onClick={() => tts.loadModel(resolved)}
                disabled={tts.phase === "loading-model"}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-accent-bright disabled:opacity-50"
              >
                {tts.phase === "loading-model" ? "Loading…" : "Load voice model"}
              </button>
            </div>

            {tts.download && (
              <div className="mt-4">
                <div className="mb-1 flex justify-between font-mono text-xs text-muted">
                  <span>
                    Downloading model · ~{tts.download.totalMB || approxDownloadMB(resolved)} MB
                  </span>
                  <span>{Math.round(tts.download.progress * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-bg">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-200"
                    style={{ width: `${Math.round(tts.download.progress * 100)}%` }}
                  />
                </div>
              </div>
            )}
            {tts.notice && (
              <p className="mt-3 text-sm text-amber-400">{tts.notice}</p>
            )}
            {tts.phase === "error" && tts.error && (
              <p className="mt-3 text-sm text-red-400">Error: {tts.error}</p>
            )}
          </section>
        )}

        {/* File input */}
        <section
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          className="mb-6 rounded-lg border border-dashed border-border bg-surface/40 p-6 text-center"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.md,.markdown,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
          <p className="mb-3 text-sm text-muted">
            Drop a <span className="text-text">PDF</span> or{" "}
            <span className="text-text">Markdown</span> file here, or
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent hover:text-bg"
          >
            Choose a file
          </button>
          {fileName && (
            <p className="mt-3 font-mono text-xs text-muted">
              {extracting ? "Extracting… " : ""}
              {fileName}
            </p>
          )}
          {scanned && (
            <p className="mt-3 text-sm text-amber-400">
              This PDF has little or no selectable text — it looks scanned
              (image-only). OCR isn't available yet, so there's nothing to read
              aloud.
            </p>
          )}
          {fileError && <p className="mt-3 text-sm text-red-400">{fileError}</p>}
        </section>

        {/* Read-aloud trigger */}
        {docText && !scanned && (
          <div className="mb-4 flex items-center gap-3">
            <button
              onClick={() => tts.speak(docText, tts.voice)}
              disabled={tts.phase !== "ready" || tts.generating}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-accent-bright disabled:opacity-50"
            >
              {tts.generating ? "Reading…" : "▶ Read aloud"}
            </button>
            {tts.phase !== "ready" && (
              <span className="text-xs text-muted">Load the voice model first.</span>
            )}
            <span className="font-mono text-xs text-muted">
              {docText.replace(/\s+/g, " ").trim().split(" ").length.toLocaleString()}{" "}
              words
            </span>
          </div>
        )}

        {/* Reader */}
        <section className="rounded-lg border border-border bg-surface p-5">
          <Reader
            sentences={tts.sentences}
            previewText={docText}
            currentSentence={tts.currentSentence}
            currentTime={tts.currentTime}
            onSentenceClick={tts.seekToSentence}
          />
        </section>
      </main>

      <PlayerBar
        isPlaying={tts.isPlaying}
        buffering={tts.buffering}
        generating={tts.generating}
        canPlay={canPlay}
        speed={tts.speed}
        voice={tts.voice}
        onToggle={tts.toggle}
        onPrev={() => tts.seekToSentence(Math.max(0, tts.currentSentence - 1))}
        onNext={() => tts.seekToSentence(Math.max(0, tts.currentSentence) + 1)}
        onSpeed={tts.setSpeed}
        onVoice={tts.setVoice}
      />
    </div>
  );
}

function EngineBadge({
  ready,
  device,
  dtype,
}: {
  ready: boolean;
  device: string;
  dtype: string;
}) {
  return (
    <span
      className={`rounded-full border px-3 py-1 font-mono text-xs ${
        ready
          ? "border-accent/40 bg-accent/10 text-accent-bright"
          : "border-border bg-bg text-muted"
      }`}
    >
      {ready ? "● " : "○ "}
      {device} · {dtype}
    </span>
  );
}
