import { useCallback, useEffect, useRef, useState } from "react";
import type { Chunk, FromWorker, ToWorker } from "../lib/types";
import { approxDownloadMB, type EnginePair } from "../lib/device";
import { DEFAULT_VOICE } from "../lib/voices";
import { sectionJump, type Segment } from "../lib/segment";
import { minSpeakIndex, type Step } from "../lib/schedule";
import type { ExportMode } from "../lib/types";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

export type ExportOptions = {
  bitrate: number;
  mode: ExportMode;
  sections: { startIndex: number; title: string }[];
  docTitle: string;
};

function triggerDownload(data: ArrayBuffer, mime: string, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type Phase = "idle" | "loading-model" | "ready" | "error";
export type DownloadState = { progress: number; file: string; totalMB: number };

type Internal = {
  els: [HTMLAudioElement, HTMLAudioElement];
  active: 0 | 1;
  urls: (string | undefined)[];
  durations: number[];
  count: number;
  segments: Segment[];
  schedule: Step[];
  stepPtr: number;
  playingIndex: number;
  waitingFor: number | null;
  speed: number;
};

export function useTts() {
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
  const iRef = useRef<Internal | null>(null);
  const apiRef = useRef<{ goToStep: (p: number) => void }>({ goToStep: () => {} });
  const attemptRef = useRef<EnginePair | null>(null);
  const triedFallbackRef = useRef(false);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStallTimer = () => {
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    stallTimerRef.current = null;
  };
  // If no bytes flow within the window, the fetch is almost certainly blocked
  // (extension / ad-blocker / VPN / network filter) — say so instead of hanging.
  const startStallTimer = () => {
    clearStallTimer();
    stallTimerRef.current = setTimeout(() => {
      stallTimerRef.current = null;
      setDownload(null);
      setPhase("error");
      setError(
        "The voice model didn't start downloading (no data after 30s). Something is blocking it — usually a browser extension (ad-blocker, media/video helper), a VPN, or a network filter. Try an incognito window, whitelist huggingface.co, or clear this site's data, then Load again.",
      );
    }, 30_000);
  };

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [download, setDownload] = useState<DownloadState | null>(null);

  const [durations, setDurations] = useState<number[]>([]);
  const [generating, setGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [currentSentence, setCurrentSentence] = useState(-1);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeedState] = useState(1);
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    const els: [HTMLAudioElement, HTMLAudioElement] = [new Audio(), new Audio()];
    els.forEach((el) => {
      el.preload = "auto";
      el.preservesPitch = true;
    });
    const st: Internal = {
      els,
      active: 0,
      urls: [],
      durations: [],
      count: 0,
      segments: [],
      schedule: [],
      stepPtr: -1,
      playingIndex: -1,
      waitingFor: null,
      speed: 1,
    };
    iRef.current = st;

    const activeEl = () => st.els[st.active];
    const idleEl = () => st.els[st.active === 0 ? 1 : 0];

    const nextSpeakStep = (afterPtr: number): number => {
      for (let p = afterPtr + 1; p < st.schedule.length; p++) return p;
      return -1;
    };

    const preloadNext = () => {
      const p = nextSpeakStep(st.stepPtr);
      if (p < 0) return;
      const url = st.urls[st.schedule[p].index];
      if (url) {
        const el = idleEl();
        if (el.src !== url) {
          el.src = url;
          el.load(); // decode ahead so the boundary flip is gapless
        }
      }
    };

    const playSeg = (index: number) => {
      const url = st.urls[index];
      st.playingIndex = index;
      if (!url) {
        st.waitingFor = index;
        setBuffering(true);
        setIsPlaying(true);
        setCurrentSentence(index);
        setCurrentTime(0);
        return;
      }
      st.waitingFor = null;
      setBuffering(false);
      if (idleEl().src === url) st.active = st.active === 0 ? 1 : 0; // gapless flip
      const el = activeEl();
      if (el.src !== url) el.src = url;
      el.playbackRate = st.speed;
      el.preservesPitch = true;
      setCurrentSentence(index);
      setCurrentTime(0);
      setIsPlaying(true);
      void el.play().catch(() => setIsPlaying(false));
      preloadNext();
    };

    const executeStep = () => {
      if (st.stepPtr < 0 || st.stepPtr >= st.schedule.length) {
        setIsPlaying(false);
        setCurrentSentence(-1);
        setCurrentTime(0);
        st.playingIndex = -1;
        return;
      }
      playSeg(st.schedule[st.stepPtr].index);
    };

    const stepForward = () => {
      st.stepPtr++;
      executeStep();
    };

    const goToStep = (p: number) => {
      st.stepPtr = p;
      executeStep();
    };
    apiRef.current = { goToStep };

    els.forEach((el) => {
      el.addEventListener("ended", () => {
        if (el === activeEl()) stepForward();
      });
    });

    const worker = new Worker(new URL("../worker/tts.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;

    worker.addEventListener("message", (e: MessageEvent<FromWorker>) => {
      const msg = e.data;
      switch (msg.type) {
        case "download":
          clearStallTimer(); // bytes are flowing — not blocked
          setDownload({
            progress: msg.progress / 100,
            file: msg.file,
            totalMB: Math.round(msg.total / 1_000_000),
          });
          break;
        case "ready":
          clearStallTimer();
          attemptRef.current = null;
          setPhase("ready");
          setDownload(null);
          break;
        case "error": {
          clearStallTimer();
          const attempt = attemptRef.current;
          if (attempt?.device === "webgpu" && !triedFallbackRef.current) {
            triedFallbackRef.current = true;
            const fb = { device: "wasm", dtype: "q8" } as const;
            attemptRef.current = { device: fb.device, dtype: fb.dtype };
            setNotice(
              "WebGPU unavailable on this browser — falling back to the wasm engine (~90 MB).",
            );
            setError(null);
            setPhase("loading-model");
            setDownload({
              progress: 0,
              file: "",
              totalMB: approxDownloadMB(attemptRef.current),
            });
            startStallTimer();
            worker.postMessage({
              type: "init",
              modelId: MODEL_ID,
              device: fb.device,
              dtype: fb.dtype,
            } satisfies ToWorker);
          } else {
            setError(msg.message);
            setPhase((p) => (p === "loading-model" ? "error" : p));
            setGenerating(false);
            setExporting(false);
            setExportProgress(null);
          }
          break;
        }
        case "export-progress":
          if (msg.jobId !== jobRef.current) return;
          setExportProgress({ done: msg.done, total: msg.total });
          break;
        case "export-done":
          if (msg.jobId !== jobRef.current) return;
          triggerDownload(msg.data, msg.mime, msg.filename);
          setExporting(false);
          setExportProgress(null);
          break;
        case "chunk": {
          if (msg.jobId !== jobRef.current) return;
          const c: Chunk = msg.chunk;
          const url = URL.createObjectURL(new Blob([c.wav], { type: "audio/wav" }));
          st.urls[c.index] = url;
          st.durations[c.index] = c.duration;
          setDurations((prev) => {
            const copy = prev.slice();
            copy[c.index] = c.duration;
            return copy;
          });
          if (st.waitingFor === c.index) playSeg(c.index);
          else preloadNext();
          break;
        }
        case "done":
          if (msg.jobId !== jobRef.current) return;
          setGenerating(false);
          break;
      }
    });

    return () => {
      clearStallTimer();
      worker.terminate();
      els.forEach((el) => el.pause());
      st.urls.forEach((u) => u && URL.revokeObjectURL(u));
    };
  }, []);

  // rAF loop drives smooth in-sentence time for estimated word tracking.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      const st = iRef.current;
      if (st) setCurrentTime(st.els[st.active].currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  const send = (msg: ToWorker, transfer?: Transferable[]) =>
    workerRef.current?.postMessage(msg, transfer ?? []);

  const loadModel = useCallback((pair: EnginePair) => {
    setError(null);
    setNotice(null);
    triedFallbackRef.current = false;
    attemptRef.current = pair;
    setPhase("loading-model");
    setDownload({ progress: 0, file: "", totalMB: approxDownloadMB(pair) });
    startStallTimer();
    send({ type: "init", modelId: MODEL_ID, device: pair.device, dtype: pair.dtype });
  }, []);

  /**
   * Begin reading. `schedule` defines playback order; `spoken` is the per-segment
   * normalized text sent to Kokoro; `segments` drives display. `startStep`
   * resumes at a schedule step.
   */
  const speak = useCallback(
    (
      segments: Segment[],
      spoken: string[],
      schedule: Step[],
      voiceId: string,
      startStep = 0,
    ) => {
      const st = iRef.current;
      if (!st || phase !== "ready" || segments.length === 0 || schedule.length === 0)
        return;
      send({ type: "cancel" });
      st.els.forEach((el) => el.pause());
      st.urls.forEach((u) => u && URL.revokeObjectURL(u));
      st.urls = new Array(segments.length);
      st.durations = new Array(segments.length);
      st.count = segments.length;
      st.segments = segments;
      st.schedule = schedule;
      st.stepPtr = startStep - 1;
      st.playingIndex = -1;
      st.waitingFor = null;
      st.active = 0;
      setDurations([]);
      setCurrentSentence(-1);
      setCurrentTime(0);
      setBuffering(true);
      setGenerating(true);
      const jobId = ++jobRef.current;
      const genStart = minSpeakIndex(schedule.slice(Math.max(0, startStep)));
      send({
        type: "generate",
        jobId,
        sentences: spoken,
        voice: voiceId,
        startIndex: genStart,
      });
      apiRef.current.goToStep(Math.max(0, startStep));
    },
    [phase],
  );

  const play = useCallback(() => {
    const st = iRef.current;
    if (!st) return;
    const el = st.els[st.active];
    if (el.src) {
      setIsPlaying(true);
      void el.play().catch(() => setIsPlaying(false));
    } else if (st.schedule.length > 0) {
      apiRef.current.goToStep(Math.max(0, st.stepPtr));
    }
  }, []);

  const pause = useCallback(() => {
    const st = iRef.current;
    if (!st) return;
    st.els[st.active].pause();
    setIsPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, play, pause]);

  const seekToSentence = useCallback((segIndex: number) => {
    const st = iRef.current;
    if (!st) return;
    let best = -1;
    for (let p = 0; p < st.schedule.length; p++) {
      if (st.schedule[p].index === segIndex) {
        best = p;
        break;
      }
      if (st.schedule[p].index <= segIndex) best = p;
    }
    if (best >= 0) apiRef.current.goToStep(best);
  }, []);

  const nextSentence = useCallback(() => {
    const st = iRef.current;
    if (st && st.stepPtr + 1 < st.schedule.length) apiRef.current.goToStep(st.stepPtr + 1);
  }, []);

  const prevSentence = useCallback(() => {
    const st = iRef.current;
    if (st) apiRef.current.goToStep(Math.max(0, st.stepPtr - 1));
  }, []);

  const jumpSection = useCallback(
    (dir: 1 | -1) => {
      const st = iRef.current;
      if (!st) return;
      const target = sectionJump(st.segments, Math.max(0, st.playingIndex), dir);
      seekToSentence(target);
    },
    [seekToSentence],
  );

  const rewind = useCallback((seconds = 10) => {
    const st = iRef.current;
    if (!st || st.playingIndex < 0) return;
    let acc = st.els[st.active].currentTime;
    let p = st.stepPtr;
    while (acc < seconds && p > 0) {
      p--;
      acc += st.durations[st.schedule[p].index] ?? 0;
    }
    apiRef.current.goToStep(p);
  }, []);

  const setSpeed = useCallback((x: number) => {
    setSpeedState(x);
    const st = iRef.current;
    if (st) {
      st.speed = x;
      st.els.forEach((el) => {
        el.playbackRate = x;
        el.preservesPitch = true;
      });
    }
  }, []);

  const cancelExport = useCallback(() => {
    send({ type: "cancel" }); // bumps the worker's activeJob; the export loop bails
    setExporting(false);
    setExportProgress(null);
  }, []);

  const exportAudio = useCallback(
    (spoken: string[], voiceId: string, opts: ExportOptions) => {
      const st = iRef.current;
      if (!st || phase !== "ready" || spoken.length === 0 || exporting) return;
      send({ type: "cancel" });
      st.els.forEach((el) => el.pause());
      setIsPlaying(false);
      setExporting(true);
      setExportProgress({ done: 0, total: spoken.length });
      const jobId = ++jobRef.current;
      send({
        type: "export",
        jobId,
        sentences: spoken,
        voice: voiceId,
        bitrate: opts.bitrate,
        mode: opts.mode,
        sections: opts.sections,
        docTitle: opts.docTitle,
      });
    },
    [phase, exporting],
  );

  // ---- Media Session ----
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => play());
    ms.setActionHandler("pause", () => pause());
    ms.setActionHandler("previoustrack", () => prevSentence());
    ms.setActionHandler("nexttrack", () => nextSentence());
    ms.setActionHandler("seekbackward", () => rewind(10));
    return () => {
      (["play", "pause", "previoustrack", "nexttrack", "seekbackward"] as const).forEach(
        (a) => ms.setActionHandler(a, null),
      );
    };
  }, [play, pause, prevSentence, nextSentence, rewind]);

  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    }
  }, [isPlaying]);

  return {
    phase,
    error,
    notice,
    download,
    durations,
    generating,
    isPlaying,
    buffering,
    currentSentence,
    currentTime,
    speed,
    voice,
    exporting,
    exportProgress,
    setVoice,
    loadModel,
    speak,
    exportAudio,
    cancelExport,
    play,
    pause,
    toggle,
    seekToSentence,
    nextSentence,
    prevSentence,
    jumpSection,
    rewind,
    setSpeed,
  };
}
