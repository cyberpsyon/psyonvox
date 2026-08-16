# PsyonVox

Browser-based, privacy-first text-to-speech reader for study material. Loads a
PDF or Markdown file, cleans the text, and reads it aloud using the open-source
**Kokoro-82M** voice model running **entirely in your browser** — your files
never leave your device.

Built by [CyberPsyon](https://cyberpsyon.com).

> **Status:** Phase 1 (MVP core reader). PDF + Markdown → in-browser Kokoro
> streaming playback with play/pause, 28-voice picker, 0.5×–2× speed, and
> active-sentence highlighting with estimated word tracking.

## Quickstart (web app)

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build
```

On first use, click **Load voice model** — this downloads the Kokoro model
once (~90 MB on the wasm/q8 path, ~330 MB on the WebGPU/fp32 path) and caches
it on the device. Then drop a PDF or Markdown file and hit **Read aloud**.

### Engine

- All TTS generation runs in a **Web Worker** — the UI never freezes.
- Device/dtype auto-select: **WebGPU → fp32** (faster, larger download) when
  `navigator.gpu` is available, otherwise **wasm → q8** (reliable everywhere).
  Override it in the engine picker.
- Playback uses a single persistent `<audio>` element (sequential blob queue)
  so `playbackRate` speed control and future lock-screen controls work cleanly.

## Privacy

Everything runs locally in the browser. Documents are parsed on-device and
audio is generated on-device. Nothing is uploaded.

## Credits

- Voice model: **Kokoro-82M** by hexgrad (Apache-2.0).
- In-browser inference: **kokoro-js** / transformers.js (Xenova).
- PDF extraction: **pdf.js**. Markdown: **marked**.

## License

MIT. Kokoro is Apache-2.0 (compatible).
