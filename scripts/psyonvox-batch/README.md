# PsyonVox batch converter

Convert a whole folder of documents to MP3 at full speed, locally. Same
Kokoro-82M model, voices, and `shared/pronunciations.json` as the web app, so
speech is consistent across both. Recursive, resumable, privacy-first (nothing
leaves your machine).

## System dependencies

These are **not** pip packages — install them first:

- **espeak-ng** — phonemizer fallback for out-of-dictionary words
  - Ubuntu/Debian: `sudo apt install espeak-ng`
  - macOS: `brew install espeak-ng`
- **ffmpeg** — MP3 encoding (Kokoro outputs WAV)
  - Ubuntu/Debian: `sudo apt install ffmpeg` · macOS: `brew install ffmpeg`

GPU is automatic: PyTorch uses **CUDA** on Linux+NVIDIA, **MPS** on Apple
Silicon, and CPU otherwise (fine for the 82M model).

## Quickstart

```bash
cd scripts/psyonvox-batch
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python psyonvox_batch.py /path/to/study-materials --out ./audiobooks --voice af_heart
```

Output mirrors the input folder structure. Re-running skips files already
converted (tracked by content hash in `.psyonvox-manifest.json`).

## Options

| Flag | Default | Meaning |
|---|---|---|
| `input` | — | File or folder (folders are recursive) |
| `--out` | `psyonvox-out` | Output folder (mirrors input structure) |
| `--voice` | `af_heart` | Any Kokoro voice id (e.g. `am_michael`, `bf_emma`) |
| `--speed` | `1.0` | Speaking speed |
| `--bitrate` | `64` | MP3 bitrate in kbps (64 is fine for voice) |
| `--resume` / `--no-resume` | resume | Skip already-converted files, or redo all |
| `--no-strip-junk` | off | Keep URLs / inline citations |
| `--no-spell-acronyms` | off | Don't spell out unknown acronyms |

Supported inputs: `.txt` `.md` `.pdf` `.docx` `.pptx` `.epub`.
