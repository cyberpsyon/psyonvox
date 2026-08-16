import { useCallback, useEffect, useRef, useState } from "react";
import type { Chunk, FromWorker, ToWorker } from "../lib/types";
import { approxDownloadMB, type EnginePair } from "../lib/device";
import { DEFAULT_VOICE } from "../lib/voices";
import { sectionJump, type Segment } from "../lib/segment";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

export type Phase = "idle" | "loading-model" | "ready" | "error";

export type DownloadState = {
  progress: number; // 0..1
  file: string;
  totalMB: number;
};

type Internal = {
  els: [HTMLAudioElement, HTMLAudioElement]; // gapless double-buffer
  active: 0 | 1;
  urls: (string | undefined)[];
  durations: number[];
  count: number;
  generationDone: boolean;
  playingIndex: number;
  waitingFor: number | null;
  autoplay: boolean;
  speed: number;
  segments: Segment[];
};

export function useTts() {
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
  const iRef = useRef<Internal | null>(null);
  const attemptRef = useRef<EnginePair | null>(null);
  const triedFallbackRef = useRef(false);
  const playIndexRef = useRef<(i: number) => void>(() => {});

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
      generationDone: false,
      playingIndex: -1,
      waitingFor: null,
      autoplay: false,
      speed: 1,
      segments: [],
    };
    iRef.current = st;

    const activeEl = () => st.els[st.active];
    const idleEl = () => st.els[st.active === 0 ? 1 : 0];
    const preloadNext = (i: number) => {
      const url = st.urls[i + 1];
      if (url) {
        const el = idleEl();
        if (el.src !== url) {
          el.src = url;
          el.load(); // decode ahead so the boundary flip is gapless
        }
      }
    };

    const playIndex = (i: number) => {
      if (i < 0 || i >= st.count) return;
      const url = st.urls[i];
      st.playingIndex = i;
      if (!url) {
        // Audio for this index isn't generated yet — show the target, wait.
        st.waitingFor = i;
        setBuffering(true);
        setCurrentSentence(i);
        setCurrentTime(0);
        return;
      }
      st.waitingFor = null;
      setBuffering(false);
      const el = activeEl();
      el.src = url;
      el.playbackRate = st.speed;
      el.preservesPitch = true;
      setCurrentSentence(i);
      setCurrentTime(0);
      void el.play().catch(() => setIsPlaying(false));
      preloadNext(i);
    };
    playIndexRef.current = playIndex;

    const advance = () => {
      const next = st.playingIndex + 1;
      if (next < st.count && st.urls[next]) {
        // Gapless: the idle element was preloaded with `next` — flip to it.
        st.active = st.active === 0 ? 1 : 0;
        const el = activeEl();
        if (el.src !== st.urls[next]) el.src = st.urls[next]!;
        el.playbackRate = st.speed;
        el.preservesPitch = true;
        st.playingIndex = next;
        st.waitingFor = null;
        setCurrentSentence(next);
        setCurrentTime(0);
        void el.play().catch(() => setIsPlaying(false));
        preloadNext(next);
      } else if (st.generationDone && next >= st.count) {
        setIsPlaying(false);
        setCurrentSentence(-1);
        setCurrentTime(0);
      } else {
        st.waitingFor = next;
        setBuffering(true);
      }
    };

    els.forEach((el) => {
      el.addEventListener("ended", () => {
        if (el === activeEl()) advance();
      });
      el.addEventListener("play", () => setIsPlaying(true));
      el.addEventListener("pause", () => {
        if (el === activeEl() && !el.ended) setIsPlaying(false);
      });
    });

    const worker = new Worker(
      new URL("../worker/tts.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;

    worker.addEventListener("message", (e: MessageEvent<FromWorker>) => {
      const msg = e.data;
      switch (msg.type) {
        case "download":
          setDownload({
            progress: msg.progress / 100,
            file: msg.file,
            totalMB: Math.round(msg.total / 1_000_000),
          });
          break;
        case "ready":
          attemptRef.current = null;
          setPhase("ready");
          setDownload(null);
          break;
        case "error": {
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
          }
          break;
        }
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
          if (st.autoplay && st.playingIndex === -1) {
            playIndex(c.index); // first generated chunk starts playback
          } else if (st.waitingFor === c.index) {
            playIndex(c.index); // resume from a buffer underrun
          } else if (c.index === st.playingIndex + 1) {
            preloadNext(st.playingIndex); // arrived late — preload for gapless flip
          }
          break;
        }
        case "done":
          if (msg.jobId !== jobRef.current) return;
          st.generationDone = true;
          setGenerating(false);
          break;
      }
    });

    return () => {
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
    send({ type: "init", modelId: MODEL_ID, device: pair.device, dtype: pair.dtype });
  }, []);

  /**
   * Begin reading a pre-segmented document. `spoken` is the per-segment text
   * actually sent to Kokoro (pronunciation-normalized, code/tables announced);
   * `segments` drives the display and must be the same length.
   */
  const speak = useCallback(
    (segments: Segment[], spoken: string[], voiceId: string, startIndex = 0) => {
      const st = iRef.current;
      if (!st || phase !== "ready" || segments.length === 0) return;
      send({ type: "cancel" });
      st.els.forEach((el) => el.pause());
      st.urls.forEach((u) => u && URL.revokeObjectURL(u));
      st.urls = new Array(segments.length);
      st.durations = new Array(segments.length);
      st.count = segments.length;
      st.segments = segments;
      st.generationDone = false;
      st.playingIndex = -1;
      st.waitingFor = null;
      st.active = 0;
      st.autoplay = true;
      setDurations([]);
      setCurrentSentence(-1);
      setCurrentTime(0);
      setBuffering(true);
      setGenerating(true);
      const jobId = ++jobRef.current;
      send({
        type: "generate",
        jobId,
        sentences: spoken,
        voice: voiceId,
        startIndex,
      });
    },
    [phase],
  );

  const play = useCallback(() => {
    const st = iRef.current;
    if (!st) return;
    const el = st.els[st.active];
    if (el.src) void el.play().catch(() => {});
    else if (st.count > 0) playIndexRef.current(Math.max(0, st.playingIndex));
  }, []);

  const pause = useCallback(() => {
    const st = iRef.current;
    if (st) st.els[st.active].pause();
  }, []);

  const toggle = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, play, pause]);

  const seekToSentence = useCallback((i: number) => {
    playIndexRef.current(i);
  }, []);

  const nextSentence = useCallback(() => {
    const st = iRef.current;
    if (st) playIndexRef.current(Math.max(0, st.playingIndex) + 1);
  }, []);

  const prevSentence = useCallback(() => {
    const st = iRef.current;
    if (st) playIndexRef.current(Math.max(0, st.playingIndex - 1));
  }, []);

  const jumpSection = useCallback((dir: 1 | -1) => {
    const st = iRef.current;
    if (!st) return;
    const target = sectionJump(st.segments, Math.max(0, st.playingIndex), dir);
    playIndexRef.current(target);
  }, []);

  /** ~10-second rewind, landing on a sentence boundary (per-sentence clips). */
  const rewind = useCallback((seconds = 10) => {
    const st = iRef.current;
    if (!st || st.playingIndex < 0) return;
    let acc = st.els[st.active].currentTime;
    let i = st.playingIndex;
    while (i > 0 && acc < seconds) {
      i--;
      acc += st.durations[i] ?? 0;
    }
    playIndexRef.current(i);
  }, []);

  // ---- Media Session: lock-screen / headphone controls ----
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
    setVoice,
    loadModel,
    speak,
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
