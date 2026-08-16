import type { Device, Dtype } from "./device";

/** A generated sentence chunk delivered from the worker to the player. */
export type Chunk = {
  index: number;
  text: string;
  /** WAV audio (44-byte header + PCM) as a transferable ArrayBuffer. */
  wav: ArrayBuffer;
  /** Audio duration in seconds, derived from sample count / sampling rate. */
  duration: number;
};

// ---- Main thread -> Worker ----
export type ToWorker =
  | {
      type: "init";
      modelId: string;
      device: Device;
      dtype: Dtype;
    }
  | {
      type: "generate";
      jobId: number;
      text: string;
      voice: string;
    }
  | { type: "cancel" };

// ---- Worker -> Main thread ----
export type FromWorker =
  | { type: "download"; loaded: number; total: number; progress: number; file: string }
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "chunk"; jobId: number; chunk: Chunk }
  | { type: "done"; jobId: number };
