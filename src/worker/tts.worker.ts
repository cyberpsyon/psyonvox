/// <reference lib="webworker" />
import { KokoroTTS } from "kokoro-js";
import JSZip from "jszip";
import type { FromWorker, ToWorker } from "../lib/types";
import { encodeWav16 } from "./wav";
import { buildChapterTag, concat, Mp3Writer, type Chapter } from "./mp3";

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
  const { sentences, startIndex } = msg;
  try {
    // One generate() per sentence keeps a stable 1:1 index mapping to the
    // pre-split display, which powers exact highlighting, resume, and sections.
    for (let i = startIndex; i < sentences.length; i++) {
      if (myJob !== activeJob) return; // cancelled / superseded
      const text = sentences[i];
      // Voice id is validated in the UI; cast past the narrow keyof-VOICES type.
      const audio = await tts.generate(text, { voice: msg.voice as never });
      if (myJob !== activeJob) return;
      if (!audio.audio || audio.audio.length === 0) continue; // skip empty clips
      // Re-encode to 16-bit PCM (see wav.ts) — kokoro's float WAV is unreliable
      // in the browser <audio> element.
      const wav = encodeWav16(audio.audio, audio.sampling_rate);
      const duration = audio.audio.length / audio.sampling_rate;
      post(
        {
          type: "chunk",
          jobId: msg.jobId,
          chunk: { index: i, text, wav, duration },
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

const SR = 24000;

function safeName(s: string): string {
  return (s || "psyonvox").replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
}

type SectionRange = { start: number; end: number; title: string };

function sectionRanges(
  sections: { startIndex: number; title: string }[],
  total: number,
  docTitle: string,
): SectionRange[] {
  if (sections.length === 0) return [{ start: 0, end: total, title: docTitle }];
  const sorted = [...sections].sort((a, b) => a.startIndex - b.startIndex);
  return sorted.map((s, i) => ({
    start: s.startIndex,
    end: i + 1 < sorted.length ? sorted[i + 1].startIndex : total,
    title: s.title,
  }));
}

async function exportAudio(msg: Extract<ToWorker, { type: "export" }>) {
  if (!tts) {
    post({ type: "error", message: "Model not loaded yet." });
    return;
  }
  const myJob = ++activeJob;
  const { sentences, voice, bitrate, mode, sections, docTitle } = msg;
  const total = sentences.length;
  const gen = (i: number) => tts!.generate(sentences[i], { voice: voice as never });

  try {
    if (mode === "zip") {
      const zip = new JSZip();
      const ranges = sectionRanges(sections, total, docTitle);
      let done = 0;
      for (let s = 0; s < ranges.length; s++) {
        const { start, end, title } = ranges[s];
        const writer = new Mp3Writer(SR, bitrate);
        for (let i = start; i < end; i++) {
          if (myJob !== activeJob) return;
          writer.add((await gen(i)).audio);
          post({ type: "export-progress", jobId: msg.jobId, done: ++done, total });
        }
        zip.file(`${String(s + 1).padStart(2, "0")} ${safeName(title)}.mp3`, writer.finish());
      }
      const data = (await zip.generateAsync({ type: "arraybuffer" })) as ArrayBuffer;
      post(
        { type: "export-done", jobId: msg.jobId, data, mime: "application/zip", filename: `${safeName(docTitle)}.zip` },
        [data],
      );
      return;
    }

    // single MP3, optionally with ID3 chapters at section starts
    const writer = new Mp3Writer(SR, bitrate);
    const sectionAt = new Map(sections.map((s) => [s.startIndex, s.title]));
    const chapters: Chapter[] = [];
    let chapStartMs = 0;
    let chapTitle = sectionAt.get(0) ?? docTitle;
    for (let i = 0; i < total; i++) {
      if (myJob !== activeJob) return;
      if (mode === "chapters" && i > 0 && sectionAt.has(i)) {
        const nowMs = Math.round(writer.seconds * 1000);
        chapters.push({ startMs: chapStartMs, endMs: nowMs, title: chapTitle });
        chapStartMs = nowMs;
        chapTitle = sectionAt.get(i)!;
      }
      writer.add((await gen(i)).audio);
      post({ type: "export-progress", jobId: msg.jobId, done: i + 1, total });
    }
    const mp3 = writer.finish();
    let out = mp3;
    if (mode === "chapters") {
      chapters.push({ startMs: chapStartMs, endMs: Math.round(writer.seconds * 1000), title: chapTitle });
      out = concat([buildChapterTag(chapters, docTitle), mp3]);
    }
    const data = out.buffer.slice(
      out.byteOffset,
      out.byteOffset + out.byteLength,
    ) as ArrayBuffer;
    post(
      { type: "export-done", jobId: msg.jobId, data, mime: "audio/mpeg", filename: `${safeName(docTitle)}.mp3` },
      [data],
    );
  } catch (err) {
    if (myJob === activeJob) post({ type: "error", message: (err as Error).message ?? String(err) });
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
      case "export":
        await exportAudio(msg);
        break;
      case "cancel":
        activeJob++; // invalidate any running loop
        break;
    }
  } catch (err) {
    post({ type: "error", message: (err as Error).message ?? String(err) });
  }
});
