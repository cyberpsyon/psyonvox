import { useCallback, useEffect, useRef, useState } from "react";
import type { Chunk, FromWorker, ToWorker } from "../lib/types";
import { approxDownloadMB, type EnginePair } from "../lib/device";
import { DEFAULT_VOICE } from "../lib/voices";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

export type Sentence = { index: number; text: string; duration: number };
export type Phase = "idle" | "loading-model" | "ready" | "error";

export type DownloadState = {
  progress: number; // 0..1
  file: string;
  totalMB: number;
};

type Internal = {
  audio: HTMLAudioElement;
  urls: string[]; // objectURL per sentence index
  generationDone: boolean;
  playingIndex: number;
  waitingFor: number | null; // index we're stalled on (buffer underrun)
  autoplay: boolean;
  speed: number;
};

export function useTts() {
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
  const iRef = useRef<Internal | null>(null);
  const playChunkRef = useRef<(i: number) => void>(() => {});
  const attemptRef = useRef<EnginePair | null>(null);
  const triedFallbackRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [download, setDownload] = useState<DownloadState | null>(null);

  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [generating, setGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [currentSentence, setCurrentSentence] = useState(-1);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeedState] = useState(1);
  const [voice, setVoice] = useState(DEFAULT_VOICE);

  // ---- one-time setup: audio element + worker ----
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.preservesPitch = true; // keep pitch natural under playbackRate
    const st: Internal = {
      audio,
      urls: [],
      generationDone: false,
      playingIndex: -1,
      waitingFor: null,
      autoplay: false,
      speed: 1,
    };
    iRef.current = st;

    const playChunk = (i: number) => {
      if (i < 0 || i >= st.urls.length || !st.urls[i]) return;
      st.playingIndex = i;
      st.waitingFor = null;
      setBuffering(false);
      audio.src = st.urls[i];
      audio.playbackRate = st.speed;
      audio.preservesPitch = true;
      setCurrentSentence(i);
      setCurrentTime(0);
      void audio.play().catch(() => setIsPlaying(false));
    };
    playChunkRef.current = playChunk;

    audio.addEventListener("ended", () => {
      const next = st.playingIndex + 1;
      if (next < st.urls.length && st.urls[next]) {
        playChunk(next);
      } else if (st.generationDone) {
        setIsPlaying(false);
        setCurrentSentence(-1);
        setCurrentTime(0);
      } else {
        // Buffer underrun: wait for the next chunk to arrive.
        st.waitingFor = next;
        setBuffering(true);
      }
    });
    audio.addEventListener("play", () => setIsPlaying(true));
    audio.addEventListener("pause", () => {
      if (!audio.ended) setIsPlaying(false);
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
          attemptRef.current = null; // load succeeded; later errors aren't load failures
          setPhase("ready");
          setDownload(null);
          break;
        case "error": {
          const attempt = attemptRef.current;
          // WebGPU init can fail even when navigator.gpu exists (no adapter /
          // disabled by flags). Auto-fall back to the reliable wasm/q8 path once.
          if (attempt?.device === "webgpu" && !triedFallbackRef.current) {
            triedFallbackRef.current = true;
            const fb = { device: "wasm", dtype: "q8" } as const;
            attemptRef.current = { device: fb.device, dtype: fb.dtype };
            setNotice(
              "WebGPU unavailable on this browser — falling back to the wasm engine (~90 MB).",
            );
            setError(null);
            setPhase("loading-model");
            setDownload({ progress: 0, file: "", totalMB: approxDownloadMB(attemptRef.current) });
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
          const url = URL.createObjectURL(
            new Blob([c.wav], { type: "audio/wav" }),
          );
          st.urls[c.index] = url;
          setSentences((prev) => [
            ...prev,
            { index: c.index, text: c.text, duration: c.duration },
          ]);
          if (st.autoplay && st.playingIndex === -1 && c.index === 0) {
            playChunk(0);
          } else if (st.waitingFor === c.index) {
            playChunk(c.index);
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
      audio.pause();
      st.urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  // ---- rAF loop for smooth in-sentence time (word tracking) ----
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      const a = iRef.current?.audio;
      if (a) setCurrentTime(a.currentTime);
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
    send({
      type: "init",
      modelId: MODEL_ID,
      device: pair.device,
      dtype: pair.dtype,
    });
  }, []);

  const speak = useCallback(
    (text: string, voiceId: string) => {
      const st = iRef.current;
      if (!st || phase !== "ready") return;
      send({ type: "cancel" });
      st.audio.pause();
      st.urls.forEach((u) => URL.revokeObjectURL(u));
      st.urls = [];
      st.generationDone = false;
      st.playingIndex = -1;
      st.waitingFor = null;
      st.autoplay = true;
      setSentences([]);
      setCurrentSentence(-1);
      setCurrentTime(0);
      setBuffering(true);
      setGenerating(true);
      const jobId = ++jobRef.current;
      send({ type: "generate", jobId, text, voice: voiceId });
    },
    [phase],
  );

  const play = useCallback(() => {
    const st = iRef.current;
    if (!st) return;
    if (st.audio.src) {
      void st.audio.play().catch(() => {});
    } else if (st.urls.length > 0) {
      playChunkRef.current(Math.max(0, st.playingIndex));
    }
  }, []);

  const pause = useCallback(() => {
    iRef.current?.audio.pause();
  }, []);

  const toggle = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, play, pause]);

  const seekToSentence = useCallback((i: number) => {
    playChunkRef.current(i);
  }, []);

  const setSpeed = useCallback((x: number) => {
    setSpeedState(x);
    const st = iRef.current;
    if (st) {
      st.speed = x;
      st.audio.playbackRate = x;
      st.audio.preservesPitch = true;
    }
  }, []);

  return {
    phase,
    error,
    notice,
    download,
    sentences,
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
    setSpeed,
  };
}
