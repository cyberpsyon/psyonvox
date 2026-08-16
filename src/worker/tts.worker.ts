/// <reference lib="webworker" />
import { KokoroTTS, TextSplitterStream } from "kokoro-js";
import type { FromWorker, ToWorker } from "../lib/types";
import { encodeWav16 } from "./wav";

let tts: KokoroTTS | null = null;
let loading: Promise<KokoroTTS> | null = null;
// Monotonic token; any running generation loop stops once it no longer matches.
let activeJob = 0;

function post(msg: FromWorker, transfer?: Transferable[]) {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
}

async function ensureModel(msg: Extract<ToWorker, { type: "init" }>) {
  if (tts) return tts;
  if (loading) return loading;
  loading = KokoroTTS.from_pretrained(msg.modelId, {
    device: msg.device,
    dtype: msg.dtype,
    progress_callback: (p: {
      status?: string;
      file?: string;
      loaded?: number;
      total?: number;
      progress?: number;
    }) => {
      if (p.status === "progress" && p.total) {
        post({
          type: "download",
          file: p.file ?? "",
          loaded: p.loaded ?? 0,
          total: p.total,
          progress: p.progress ?? 0,
        });
      }
    },
  });
  try {
    tts = await loading;
    return tts;
  } catch (err) {
    loading = null; // clear the rejected promise so a fallback attempt can retry
    throw err;
  }
}

async function generate(msg: Extract<ToWorker, { type: "generate" }>) {
  if (!tts) {
    post({ type: "error", message: "Model not loaded yet." });
    return;
  }
  const myJob = ++activeJob;
  const splitter = new TextSplitterStream();
  // Voice id is validated in the UI against the model roster; cast past the
  // narrow keyof-VOICES literal type.
  const stream = tts.stream(splitter, { voice: msg.voice as never });
  splitter.push(msg.text);
  splitter.close();

  let index = 0;
  try {
    for await (const { text, audio } of stream) {
      if (myJob !== activeJob) return; // cancelled / superseded
      if (!audio.audio || audio.audio.length === 0) continue; // skip empty clips
      // Re-encode to 16-bit PCM (see wav.ts) — kokoro's float WAV is unreliable
      // in the browser <audio> element.
      const wav = encodeWav16(audio.audio, audio.sampling_rate);
      const duration = audio.audio.length / audio.sampling_rate;
      post(
        {
          type: "chunk",
          jobId: msg.jobId,
          chunk: { index: index++, text, wav, duration },
        },
        [wav],
      );
    }
    if (myJob === activeJob) post({ type: "done", jobId: msg.jobId });
  } catch (err) {
    if (myJob === activeJob) {
      post({ type: "error", message: (err as Error).message ?? String(err) });
    }
  }
}

self.addEventListener("message", async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "init":
        await ensureModel(msg);
        post({ type: "ready" });
        break;
      case "generate":
        await generate(msg);
        break;
      case "cancel":
        activeJob++; // invalidate any running loop
        break;
    }
  } catch (err) {
    post({ type: "error", message: (err as Error).message ?? String(err) });
  }
});
