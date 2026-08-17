# PsyonVox

**Browser-based, privacy-first text-to-speech reader for study material.** Load a
PDF, Word doc, PowerPoint, EPUB, or Markdown file and it reads aloud using the
open-source **Kokoro-82M** voice model running **entirely in your browser** —
free, private (your files never leave your device), and shareable as a static
site. A companion **Python batch script** converts whole folders to MP3 locally
at full speed.

Built by [CyberPsyon](https://cyberpsyon.com). **Try it live: [voice.cyberpsyon.com](https://voice.cyberpsyon.com)**

## Features

- **Universal input** — PDF, Markdown, TXT, Word (`.docx`), PowerPoint (`.pptx`),
  EPUB. Format parsers are lazy-loaded, so the app starts fast and only fetches
  the parser a file actually needs.
- **In-browser TTS** — Kokoro-82M via `kokoro-js`; all generation runs in a Web
  Worker so the UI never freezes. Auto-selects WebGPU (fp32) when available,
  otherwise wasm (q8), with a manual override — including a **wasm lite (q4,
  ~45 MB)** engine for metered connections, which the app suggests automatically
  when it detects data-saver mode. The model downloads once and is cached on the
  device.
- **Real audiobook player** — gapless streaming playback, 27+ voices grouped by
  accent and gender, one-tap **speed presets (1× / 1.25× / 1.5× / 2×)** plus a
  fine-adjust slider (0.5×–2×, pitch-preserved), follow-along **sentence
  highlighting** with estimated word tracking, a document progress bar with
  sentence counter, sentence/section navigation, 10-second rewind,
  click-any-sentence, resume + bookmarks + recent files, and Media Session
  (lock-screen / headphone) controls.
- **Keyboard shortcuts** — `Space` play/pause, `←`/`→` previous/next sentence,
  `[`/`]` previous/next section, `R` rewind 10 s.
- **Text intelligence** — shared pronunciation dictionary (NIST, ISO, CVE, SIEM,
  …), user-extendable in Settings; junk-skipping (URLs, citations, footnotes);
  acronym spell-out; code/table blocks announced and skipped (or read in full if
  you prefer); multi-column PDF reading order; scanned-PDF detection.
- **MP3 export** — single file, single file + ID3 chapter markers, or one MP3
  per section zipped (the always-works chapter fallback); 64/96/128 kbps, with
  live progress and cancel.
- **Privacy** — everything runs locally in the browser. Nothing is uploaded.

## How to use

1. **Load the voice model.** On first visit, pick an engine (or leave it on
   Auto) and click **Load voice model**. This is a one-time download —
   ~45–90 MB on the wasm paths, ~330 MB on WebGPU — cached on your device
   afterwards.
2. **Open a document.** Drag and drop it anywhere on the dropzone, or click the
   dropzone to browse. The extracted text appears in the reader below.
3. **Tune it (optional).** Open **Settings — pronunciation & reading** to toggle
   junk-skipping, acronym spell-out, or code-block reading, and to add custom
   pronunciations (e.g. `Kubernetes → koo-ber-net-eez`). Overrides affect speech
   only — on-screen text is unchanged.
4. **Hit Read aloud.** The current sentence highlights as it's spoken, with
   estimated word tracking, and the page follows along without fighting your
   own scrolling. Click any sentence to jump there.
5. **Drive it from the player bar.** Play/pause, sentence and section skips,
   10-second rewind, speed presets or the fine slider, and the voice picker.
   The thin bar along the top of the player shows overall document progress.
   Media keys and lock-screen controls work too.
6. **Come back later.** Progress is saved automatically. Reopen the same file
   and a **Resume at sentence N** button picks up where you left off; bookmarks
   (`＋ Bookmark`) mark spots to jump back to. Only positions are stored — never
   file contents.
7. **Export to MP3.** Choose a format (single file, chaptered file, or
   per-section ZIP) and bitrate, then **Export**. Generation runs at full speed
   independent of playback and can be cancelled mid-way.

**Word tracking is estimated.** Kokoro emits no word timestamps, so each
sentence's duration is spread across its words by length — sentence highlighting
is exact; word highlighting is a close approximation.

## Quickstart — web app

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build
```

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
Resume positions, bookmarks, and settings live in your browser's local storage;
file contents are never stored.

## Troubleshooting

- **Model download never starts** — something is blocking the fetch (usually an
  ad-blocker or media-helper extension, a VPN, or a network filter). Try an
  incognito window or whitelist `huggingface.co`. The app surfaces this after
  30 s instead of hanging.
- **"This PDF looks scanned"** — the PDF has no selectable text (image-only).
  OCR isn't supported yet, so there's nothing to read aloud.
- **Chapter markers don't show in your player** — ID3 CHAP support varies;
  export the per-section ZIP instead.

## Credits

- Voice model: **Kokoro-82M** by hexgrad (Apache-2.0).
- In-browser inference: **kokoro-js** / transformers.js by Xenova.
- PDF: **pdf.js**. Word: **mammoth**. Markdown: **marked**. MP3: **@breezystack/lamejs**.

## License

MIT (see [LICENSE](LICENSE)). Kokoro is Apache-2.0 — compatible.
