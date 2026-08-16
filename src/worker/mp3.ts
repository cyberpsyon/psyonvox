import { Mp3Encoder } from "@breezystack/lamejs";

// Incremental MP3 encoder — feed per-sentence PCM as it's generated so we never
// hold the whole uncompressed WAV of a large document in memory.
export class Mp3Writer {
  private enc: Mp3Encoder;
  private parts: Uint8Array[] = [];
  samples = 0;

  constructor(
    public sampleRate: number,
    bitrateKbps: number,
  ) {
    this.enc = new Mp3Encoder(1, sampleRate, bitrateKbps);
  }

  add(f32: Float32Array): void {
    const i16 = floatToInt16(f32);
    this.samples += i16.length;
    for (let o = 0; o < i16.length; o += 1152) {
      const block = i16.subarray(o, o + 1152);
      const mp3 = this.enc.encodeBuffer(block);
      if (mp3.length > 0) this.parts.push(mp3);
    }
  }

  /** Seconds of audio encoded so far (for chapter timestamps). */
  get seconds(): number {
    return this.samples / this.sampleRate;
  }

  finish(): Uint8Array {
    const end = this.enc.flush();
    if (end.length > 0) this.parts.push(end);
    return concat(this.parts);
  }
}

function floatToInt16(f32: Float32Array): Int16Array {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ---------- ID3v2.3 chapter tag (CHAP / CTOC) ----------
// Honored by some players (Podcast apps, foobar2000), ignored by others — the
// per-section ZIP export is the always-works fallback.
export type Chapter = { startMs: number; endMs: number; title: string };

function latin1(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function synchsafe(n: number): Uint8Array {
  return new Uint8Array([
    (n >>> 21) & 0x7f,
    (n >>> 14) & 0x7f,
    (n >>> 7) & 0x7f,
    n & 0x7f,
  ]);
}

/** A frame: 4-char id + 4-byte size (plain BE in v2.3) + 2 flag bytes + body. */
function frame(id: string, body: Uint8Array): Uint8Array {
  return concat([latin1(id), u32be(body.length), new Uint8Array([0, 0]), body]);
}

function tit2(title: string): Uint8Array {
  // encoding byte 0x00 = ISO-8859-1, then text.
  return frame("TIT2", concat([new Uint8Array([0x00]), latin1(title)]));
}

function chapFrame(elementId: string, ch: Chapter): Uint8Array {
  const body = concat([
    latin1(elementId),
    new Uint8Array([0x00]), // null-terminate element id
    u32be(ch.startMs),
    u32be(ch.endMs),
    u32be(0xffffffff), // start byte offset — unused
    u32be(0xffffffff), // end byte offset — unused
    tit2(ch.title),
  ]);
  return frame("CHAP", body);
}

function ctocFrame(childIds: string[], title: string): Uint8Array {
  const ids: Uint8Array[] = [];
  for (const id of childIds) ids.push(latin1(id), new Uint8Array([0x00]));
  const body = concat([
    latin1("toc"),
    new Uint8Array([0x00]), // element id null
    new Uint8Array([0x03]), // flags: top-level + ordered
    new Uint8Array([childIds.length & 0xff]),
    ...ids,
    tit2(title),
  ]);
  return frame("CTOC", body);
}

/** Build an ID3v2.3 tag with a table of contents + one CHAP per chapter. */
export function buildChapterTag(chapters: Chapter[], albumTitle: string): Uint8Array {
  const childIds = chapters.map((_, i) => `chp${i}`);
  const frames: Uint8Array[] = [tit2(albumTitle), ctocFrame(childIds, albumTitle)];
  chapters.forEach((ch, i) => frames.push(chapFrame(childIds[i], ch)));
  const body = concat(frames);
  const header = concat([
    latin1("ID3"),
    new Uint8Array([0x03, 0x00]), // v2.3.0
    new Uint8Array([0x00]), // flags
    synchsafe(body.length),
  ]);
  return concat([header, body]);
}
