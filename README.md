# PsyonVox

**Browser-based, privacy-first text-to-speech reader for study material.** Load a
PDF, Word doc, PowerPoint, EPUB, or Markdown file and it reads aloud using the
open-source **Kokoro-82M** voice model running **entirely in your browser** —
free, private (your files never leave your device), and shareable as a static
site. A companion **Python batch script** converts whole folders to MP3 locally
at full speed.

Built by [CyberPsyon](https://cyberpsyon.com). Live demo: _voice.cyberpsyon.com_ (coming soon).

> _Add a screenshot or GIF here once deployed._

## Features

- **Universal input** — PDF, Markdown, TXT, Word (`.docx`), PowerPoint (`.pptx`), EPUB.
- **In-browser TTS** — Kokoro-82M via `kokoro-js`; all generation runs in a Web
  Worker so the UI never freezes. Auto-selects WebGPU (fp32) when available,
  otherwise wasm (q8), with a manual override and a one-time cached download.
- **Real audiobook player** — gapless streaming playback, 27+ voices,
  0.5×–2× speed (pitch-preserved), follow-along **sentence highlighting** with
  estimated word tracking, sentence/section navigation, 10-second rewind,
  click-any-sentence, resume + bookmarks + recent files, and Media Session
  (lock-screen / headphone) controls.
- **Text intelligence** — shared pronunciation dictionary (NIST, ISO, CVE, SIEM,
  …), user-extendable in Settings; junk-skipping (URLs, citations, footnotes);
  code/table blocks announced and skipped; multi-column PDF reading order;
  scanned-PDF detection.
- **MP3 export** — single file, single file + ID3 chapter markers, or one MP3
  per section zipped (the always-works chapter fallback); 64/96/128 kbps.
- **Privacy** — everything runs locally in the browser. Nothing is uploaded.

## Quickstart — web app

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build
```

On first use, click **Load voice model** — this downloads Kokoro once
(~90 MB on the wasm/q8 path, ~330 MB on WebGPU/fp32) and caches it on the
device. Then drop a file and hit **Read aloud**.

## Quickstart — Python batch script

Converts a folder of documents to MP3 recursively (mirrored output), resumable.
Full details in [`scripts/psyonvox-batch/README.md`](scripts/psyonvox-batch/README.md).

```bash
# System deps first: espeak-ng and ffmpeg
cd scripts/psyonvox-batch
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python psyonvox_batch.py /path/to/materials --out ./audiobooks --voice af_heart
```

Both the web app and the batch script read the same
[`shared/pronunciations.json`](shared/pronunciations.json), so pronunciation is
consistent across the two.

## Deploy

`npm run build` produces a static `dist/` — host it on any static host
(Cloudflare Pages, Netlify, GitHub Pages, etc.). No server required.

## Privacy

Documents are parsed on-device and audio is generated on-device by a model that
runs in your browser. Nothing is uploaded — your files never leave your device.

## Credits

- Voice model: **Kokoro-82M** by hexgrad (Apache-2.0).
- In-browser inference: **kokoro-js** / transformers.js by Xenova.
- PDF: **pdf.js**. Word: **mammoth**. Markdown: **marked**. MP3: **@breezystack/lamejs**.

## License

MIT (see [LICENSE](LICENSE)). Kokoro is Apache-2.0 — compatible.
