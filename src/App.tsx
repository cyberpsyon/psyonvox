import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTts } from "./hooks/useTts";
import { extractFile } from "./lib/extract";
import { segment } from "./lib/segment";
import {
  approxDownloadMB,
  probeWebGPU,
  resolvePair,
  type DevicePreference,
} from "./lib/device";
import { Reader } from "./components/Reader";
import { PlayerBar } from "./components/PlayerBar";
import { Settings } from "./components/Settings";
import type { Block } from "./lib/extract";
import { linearSchedule } from "./lib/schedule";
import {
  DEFAULT_SPEECH_OPTIONS,
  mergeDict,
  toSpoken,
  type SpeechOptions,
} from "./lib/pronounce";
import {
  addBookmark,
  fileIdentity,
  getProgress,
  getSetting,
  listBookmarks,
  recentFiles,
  removeBookmark,
  saveProgress,
  setSetting,
  type Bookmark,
  type FileMeta,
} from "./lib/store";

/** Detect a metered / data-saver connection to warn before a big download. */
function isMetered(): boolean {
  const c = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!c && (c.saveData === true || /2g|3g/.test(c.effectiveType ?? ""));
}

export default function App() {
  const tts = useTts();
  const [pref, setPref] = useState<DevicePreference>("auto");
  const [fileName, setFileName] = useState("");
  const [docText, setDocText] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [webgpu, setWebgpu] = useState(false);

  // persistence
  const [fileId, setFileId] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<{ size: number; hash: string } | null>(null);
  const [resumeInfo, setResumeInfo] = useState<FileMeta | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [recent, setRecent] = useState<FileMeta[]>([]);
  const metered = useMemo(() => isMetered(), []);

  // speech settings (persisted)
  const [speechOpts, setSpeechOpts] = useState<SpeechOptions>(DEFAULT_SPEECH_OPTIONS);
  const [includeCode, setIncludeCode] = useState(false);
  const [userTerms, setUserTerms] = useState<Record<string, string>>({});
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    void Promise.all([
      getSetting<SpeechOptions>("speechOpts", DEFAULT_SPEECH_OPTIONS),
      getSetting<boolean>("includeCode", false),
      getSetting<Record<string, string>>("userTerms", {}),
    ]).then(([o, c, t]) => {
      setSpeechOpts(o);
      setIncludeCode(c);
      setUserTerms(t);
      setSettingsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (settingsLoaded) void setSetting("speechOpts", speechOpts);
  }, [speechOpts, settingsLoaded]);
  useEffect(() => {
    if (settingsLoaded) void setSetting("includeCode", includeCode);
  }, [includeCode, settingsLoaded]);
  useEffect(() => {
    if (settingsLoaded) void setSetting("userTerms", userTerms);
  }, [userTerms, settingsLoaded]);

  const dict = useMemo(() => mergeDict(userTerms), [userTerms]);

  // Real capability probe — navigator.gpu can exist without a working adapter.
  useEffect(() => {
    let alive = true;
    void probeWebGPU().then((ok) => alive && setWebgpu(ok));
    return () => {
      alive = false;
    };
  }, []);

  const resolved = resolvePair(pref, webgpu);
  const segments = useMemo(() => segment(blocks), [blocks]);
  const spoken = useMemo(
    () => segments.map((s) => toSpoken(s, dict, speechOpts, includeCode)),
    [segments, dict, speechOpts, includeCode],
  );
  const schedule = useMemo(() => linearSchedule(segments.length), [segments.length]);
  const canPlay = tts.currentSentence >= 0 || tts.durations.some((d) => d != null);
  const wordCount = useMemo(
    () => (docText ? docText.replace(/\s+/g, " ").trim().split(" ").length : 0),
    [docText],
  );

  // Load recent-files list on mount.
  useEffect(() => {
    void recentFiles().then(setRecent);
  }, []);

  const onFile = useCallback(async (file: File) => {
    setFileError(null);
    setScanned(false);
    setExtracting(true);
    setFileName(file.name);
    setResumeInfo(null);
    setBookmarks([]);
    try {
      const [{ fileId: id, hash }, res] = await Promise.all([
        fileIdentity(file),
        extractFile(file),
      ]);
      setDocText(res.text);
      setBlocks(res.blocks);
      setFileId(id);
      setFileMeta({ size: file.size, hash });
      if (res.likelyScanned) setScanned(true);
      // Prior progress / bookmarks for this exact file.
      const [progress, bms] = await Promise.all([getProgress(id), listBookmarks(id)]);
      if (progress && progress.lastIndex > 0) setResumeInfo(progress);
      setBookmarks(bms);
    } catch (err) {
      setFileError((err as Error).message ?? "Could not read that file.");
      setDocText("");
      setBlocks([]);
    } finally {
      setExtracting(false);
    }
  }, []);

  // Persist resume position as the active sentence advances (debounced).
  useEffect(() => {
    if (!fileId || !fileMeta || tts.currentSentence < 0 || segments.length === 0) return;
    const t = setTimeout(() => {
      void saveProgress({
        fileId,
        name: fileName,
        size: fileMeta.size,
        hash: fileMeta.hash,
        sentenceCount: segments.length,
        lastIndex: tts.currentSentence,
        updatedAt: Date.now(),
      }).then(() => recentFiles().then(setRecent));
    }, 800);
    return () => clearTimeout(t);
  }, [tts.currentSentence, fileId, fileMeta, fileName, segments.length]);

  // Media Session metadata (title on the lock screen).
  useEffect(() => {
    if ("mediaSession" in navigator && fileName) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: fileName,
        artist: "PsyonVox",
        album: "Read aloud",
      });
    }
  }, [fileName]);

  const onBookmark = useCallback(async () => {
    if (!fileId || tts.currentSentence < 0) return;
    const seg = segments[tts.currentSentence];
    await addBookmark({
      fileId,
      index: tts.currentSentence,
      label: seg ? seg.text.slice(0, 60) : `Sentence ${tts.currentSentence + 1}`,
      createdAt: Date.now(),
    });
    setBookmarks(await listBookmarks(fileId));
  }, [fileId, tts.currentSentence, segments]);

  const onRemoveBookmark = useCallback(
    async (id?: number) => {
      if (id == null || !fileId) return;
      await removeBookmark(id);
      setBookmarks(await listBookmarks(fileId));
    },
    [fileId],
  );

  const onAddTerm = useCallback((term: string, say: string) => {
    setUserTerms((prev) => ({ ...prev, [term]: say }));
  }, []);
  const onRemoveTerm = useCallback((term: string) => {
    setUserTerms((prev) => {
      const next = { ...prev };
      delete next[term];
      return next;
    });
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files?.[0];
      if (f) void onFile(f);
    },
    [onFile],
  );

  // ---- keyboard shortcuts (space, ←/→ sentence, [ / ] section, R rewind) ----
  const { toggle, nextSentence, prevSentence, jumpSection, rewind } = tts;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA")
        return;
      switch (e.code) {
        case "Space":
          e.preventDefault();
          toggle();
          break;
        case "ArrowRight":
          e.preventDefault();
          nextSentence();
          break;
        case "ArrowLeft":
          e.preventDefault();
          prevSentence();
          break;
        case "BracketRight":
          e.preventDefault();
          jumpSection(1);
          break;
        case "BracketLeft":
          e.preventDefault();
          jumpSection(-1);
          break;
        case "KeyR":
          e.preventDefault();
          rewind(10);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, nextSentence, prevSentence, jumpSection, rewind]);

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
            {metered && (
              <p className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
                You appear to be on a metered / data-saver connection. Consider the
                <span className="font-medium"> wasm lite (q4, ~45 MB)</span> engine
                below to save data.
              </p>
            )}
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

        {/* Recent files (resume when reopened — file contents aren't stored) */}
        {!docText && recent.length > 0 && (
          <section className="mb-6 rounded-lg border border-border bg-surface/60 p-4">
            <h3 className="mb-2 font-mono text-xs uppercase tracking-wide text-muted">
              Recent files
            </h3>
            <ul className="flex flex-col gap-1 text-sm">
              {recent.map((r) => (
                <li key={r.fileId} className="flex items-center justify-between gap-3">
                  <span className="truncate text-text/80">{r.name}</span>
                  <span className="whitespace-nowrap font-mono text-xs text-muted">
                    sentence {r.lastIndex + 1} / {r.sentenceCount}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">
              Reopen a file above to pick up where you left off.
            </p>
          </section>
        )}

        {/* Settings */}
        {docText && !scanned && (
          <Settings
            opts={speechOpts}
            onOpts={setSpeechOpts}
            includeCode={includeCode}
            onIncludeCode={setIncludeCode}
            userTerms={userTerms}
            onAddTerm={onAddTerm}
            onRemoveTerm={onRemoveTerm}
          />
        )}

        {/* Read-aloud trigger */}
        {docText && !scanned && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button
              onClick={() => tts.speak(segments, spoken, schedule, tts.voice)}
              disabled={tts.phase !== "ready" || tts.generating}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-accent-bright disabled:opacity-50"
            >
              {tts.generating ? "Reading…" : "▶ Read aloud"}
            </button>
            {resumeInfo && tts.phase === "ready" && !tts.generating && (
              <button
                onClick={() =>
                  tts.speak(
                    segments,
                    spoken,
                    linearSchedule(segments.length),
                    tts.voice,
                    resumeInfo.lastIndex,
                  )
                }
                className="rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent hover:text-bg"
              >
                ⤾ Resume at sentence {resumeInfo.lastIndex + 1}
              </button>
            )}
            <button
              onClick={() => void onBookmark()}
              disabled={tts.currentSentence < 0}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted transition-colors hover:border-accent hover:text-text disabled:opacity-40"
            >
              ＋ Bookmark
            </button>
            {tts.phase !== "ready" && (
              <span className="text-xs text-muted">Load the voice model first.</span>
            )}
            <span className="font-mono text-xs text-muted">
              {wordCount.toLocaleString()} words · {segments.length.toLocaleString()}{" "}
              sentences
            </span>
          </div>
        )}

        {/* Bookmarks */}
        {docText && bookmarks.length > 0 && (
          <div className="mb-4 rounded-lg border border-border bg-surface/60 p-3">
            <h3 className="mb-2 font-mono text-xs uppercase tracking-wide text-muted">
              Bookmarks
            </h3>
            <ul className="flex flex-col gap-1">
              {bookmarks.map((bm) => (
                <li key={bm.id} className="flex items-center gap-2 text-sm">
                  <button
                    onClick={() => tts.seekToSentence(bm.index)}
                    className="flex-1 truncate text-left text-text/80 hover:text-accent-bright"
                    title={bm.label}
                  >
                    <span className="font-mono text-xs text-muted">
                      #{bm.index + 1}
                    </span>{" "}
                    {bm.label}
                  </button>
                  <button
                    onClick={() => void onRemoveBookmark(bm.id)}
                    aria-label="Remove bookmark"
                    className="text-muted hover:text-red-400"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Reader */}
        <section className="rounded-lg border border-border bg-surface p-5">
          <Reader
            segments={segments}
            durations={tts.durations}
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
        onPrev={tts.prevSentence}
        onNext={tts.nextSentence}
        onPrevSection={() => tts.jumpSection(-1)}
        onNextSection={() => tts.jumpSection(1)}
        onRewind={() => tts.rewind(10)}
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
