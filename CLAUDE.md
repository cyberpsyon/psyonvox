# CLAUDE.md — Standing rules for PsyonVox

These rules persist across all sessions. Follow them without being re-asked.

## Hard rules

1. **Never run git commands.** Ben handles all git operations himself (add,
   commit, push, branch, tag — everything). Do not stage, commit, or push.
2. **Never commit or read `docs/BUILD-SPEC.md` into any public/committed file.**
   It is gitignored and stays local. Do not copy its contents into README,
   source comments, or anything that gets committed.
3. **Run `npm run build` to verify a clean compile before declaring any phase
   done.** No "done" claims without a passing build.

## Project shape

- React + Vite + TypeScript + Tailwind. Browser-based TTS reader using
  `kokoro-js` (model `onnx-community/Kokoro-82M-v1.0-ONNX`).
- **All TTS generation runs in a Web Worker** (`src/worker/tts.worker.ts`) —
  never on the main thread.
- Device/dtype are linked: `wasm → q8`, `webgpu → fp32` (detected via
  `navigator.gpu`), with a manual override. See `src/lib/device.ts`.
- Playback goes through a **single persistent `<audio>` element** fed a
  sequential blob queue (not raw Web Audio), with `playbackRate` +
  `preservesPitch` for speed. See `src/hooks/useTts.ts`.
- Sentence highlighting is exact (audio is generated per sentence). Word
  tracking is **estimated** — Kokoro emits no word timestamps, so a sentence's
  duration is allocated across words by character length (`src/lib/words.ts`).
  Never promise sample-accurate word sync.

## Build phases (from the spec)

1. Core reader (MVP) — ✅ done.
2. Player polish (nav, shortcuts, resume/bookmarks, Media Session, download UX) — ✅ done.
3. Text intelligence (shared pronunciation JSON, cleanup, junk-skip, scanned detection) — ✅ done.
4. Study mode — built then **removed at Ben's request** (disliked the UX). Player is linear-only.
5. Export + universal formats (MP3 single/chapters/ZIP, docx/pptx/epub) — ✅ done.
6. Python batch script + README + MIT + Netlify config + CI — ✅ done. Netlify deploy + cold-start test are Ben's to run.

When a phase works, stop and check in with Ben before starting the next.
