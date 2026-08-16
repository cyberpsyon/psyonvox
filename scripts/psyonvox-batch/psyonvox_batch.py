#!/usr/bin/env python3
"""PsyonVox batch converter — folder of documents -> MP3s, at full speed.

Mirrors the web app: same Kokoro-82M model, same 27+ voices, same cleanup rules,
and the SAME shared/pronunciations.json so speech is consistent across both.

Recursive, resumable (skips already-converted files tracked by content hash),
and honest about system dependencies. See README.md in this folder.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# ---------------------------------------------------------------------------
# Shared pronunciation dictionary (same file the web app reads)
# ---------------------------------------------------------------------------
SHARED_DICT = Path(__file__).resolve().parents[2] / "shared" / "pronunciations.json"

ROMAN = {"II", "III", "IV", "VI", "VII", "VIII", "IX", "XI", "XII", "XIII", "XIV", "XV"}
URL_RE = re.compile(r"\b(?:https?://|www\.)\S+", re.I)
BRACKET_CITATION_RE = re.compile(r"\[\s*\d+(?:\s*[-,]\s*\d+)*\s*\]")
PAREN_CITATION_RE = re.compile(
    r"\((?:[A-Z][A-Za-z'-]+(?:\s+(?:et al\.?|and|&)\s+[A-Z][A-Za-z'-]+)*,?\s+)?\d{4}[a-z]?\)"
)
FOOTNOTE_MD_RE = re.compile(r"\[\^\w+\]")
ACRONYM_RE = re.compile(r"\b[A-Z][A-Z0-9]{1,4}\b")


def load_dict() -> dict:
    if SHARED_DICT.exists():
        return json.loads(SHARED_DICT.read_text(encoding="utf-8"))
    print(f"warning: {SHARED_DICT} not found; pronunciation dictionary disabled")
    return {"patterns": [], "terms": {}}


def normalize_for_speech(text: str, d: dict, strip_junk: bool, spell: bool) -> str:
    t = text
    if strip_junk:
        for rx in (URL_RE, FOOTNOTE_MD_RE, BRACKET_CITATION_RE, PAREN_CITATION_RE):
            t = rx.sub(" ", t)
    for p in d.get("patterns", []):
        flags = re.I if "i" in p.get("flags", "") else 0
        # The shared JSON uses JS-style "$1" backrefs; Python wants "\1".
        repl = re.sub(r"\$(\d+)", r"\\\1", p["to"])
        try:
            t = re.sub(p["re"], repl, t, flags=flags)
        except re.error:
            pass
    terms = d.get("terms", {})
    if terms:
        keys = sorted(terms.keys(), key=len, reverse=True)
        lookup = {k.upper(): terms[k] for k in keys}
        pattern = r"\b(" + "|".join(re.escape(k) for k in keys) + r")\b"
        t = re.sub(pattern, lambda m: lookup.get(m.group(0).upper(), m.group(0)), t, flags=re.I)
    if spell:
        t = ACRONYM_RE.sub(lambda m: m.group(0) if m.group(0) in ROMAN else "-".join(m.group(0)), t)
    return re.sub(r"\s{2,}", " ", t).strip()


# ---------------------------------------------------------------------------
# Text cleanup (matches the web app's cleanText)
# ---------------------------------------------------------------------------
def clean_text(raw: str) -> str:
    t = raw.replace("\r\n", "\n").replace("\r", "\n")
    t = re.sub(r"(\w)-\n(\w)", r"\1\2", t)        # dehyphenate line breaks
    t = re.sub(r"\n{3,}", "\n\n", t)               # collapse to paragraph breaks
    t = re.sub(r"([^\n.!?:;])\n(?!\n)(\S)", r"\1 \2", t)  # join wrapped lines
    t = re.sub(r"[ \t]{2,}", " ", t)
    return t.strip()


# ---------------------------------------------------------------------------
# Extraction — each optional dependency degrades gracefully
# ---------------------------------------------------------------------------
SUPPORTED = {".txt", ".md", ".markdown", ".pdf", ".docx", ".pptx", ".epub"}


def extract(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in (".txt", ".md", ".markdown"):
        return clean_text(path.read_text(encoding="utf-8", errors="ignore"))
    if ext == ".pdf":
        return extract_pdf(path)
    if ext == ".docx":
        return extract_docx(path)
    if ext == ".pptx":
        return extract_pptx(path)
    if ext == ".epub":
        return extract_epub(path)
    return ""


def _need(module: str, pip_name: str):
    try:
        return __import__(module)
    except ImportError:
        raise RuntimeError(f"'{module}' is required for this file type — install with: pip install {pip_name}")


def extract_pdf(path: Path) -> str:
    pypdf = _need("pypdf", "pypdf")
    reader = pypdf.PdfReader(str(path))
    pages = [(page.extract_text() or "") for page in reader.pages]
    return clean_text("\n\n".join(pages))


def extract_docx(path: Path) -> str:
    docx = _need("docx", "python-docx")
    doc = docx.Document(str(path))
    return clean_text("\n".join(p.text for p in doc.paragraphs))


def extract_pptx(path: Path) -> str:
    pptx = _need("pptx", "python-pptx")
    prs = pptx.Presentation(str(path))
    out = []
    for i, slide in enumerate(prs.slides, 1):
        out.append(f"Slide {i}")
        for shape in slide.shapes:
            if shape.has_text_frame:
                out.append(shape.text_frame.text)
    return clean_text("\n".join(out))


def extract_epub(path: Path) -> str:
    ebooklib = _need("ebooklib", "EbookLib beautifulsoup4")
    from ebooklib import epub  # type: ignore
    from bs4 import BeautifulSoup  # type: ignore

    book = epub.read_epub(str(path))
    out = []
    for item in book.get_items():
        if item.get_type() == ebooklib.ITEM_DOCUMENT:
            soup = BeautifulSoup(item.get_content(), "html.parser")
            out.append(soup.get_text("\n"))
    return clean_text("\n\n".join(out))


# ---------------------------------------------------------------------------
# Synthesis
# ---------------------------------------------------------------------------
SAMPLE_RATE = 24000


def lang_code_for(voice: str) -> str:
    # 'a' = American English, 'b' = British English (kokoro-82M v1.0).
    return "b" if voice.startswith(("bf_", "bm_")) else "a"


def synthesize(pipeline, text: str, voice: str, speed: float):
    import numpy as np  # local import so --help works without deps

    chunks = []
    for _gs, _ps, audio in pipeline(text, voice=voice, speed=speed):
        chunks.append(audio)
    if not chunks:
        return np.zeros(0, dtype="float32")
    return np.concatenate(chunks).astype("float32")


def write_mp3(audio, out_path: Path, bitrate: int) -> None:
    import soundfile as sf  # type: ignore

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav_path = tmp.name
    try:
        sf.write(wav_path, audio, SAMPLE_RATE)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", wav_path,
             "-b:a", f"{bitrate}k", str(out_path)],
            check=True,
        )
    finally:
        os.unlink(wav_path)


# ---------------------------------------------------------------------------
# Manifest / resume
# ---------------------------------------------------------------------------
def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()[:16]


def load_manifest(out_root: Path) -> dict:
    m = out_root / ".psyonvox-manifest.json"
    if m.exists():
        try:
            return json.loads(m.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


def save_manifest(out_root: Path, manifest: dict) -> None:
    out_root.mkdir(parents=True, exist_ok=True)
    (out_root / ".psyonvox-manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def iter_files(root: Path):
    if root.is_file():
        yield root
        return
    for p in sorted(root.rglob("*")):
        if p.is_file() and p.suffix.lower() in SUPPORTED:
            yield p


def main() -> int:
    ap = argparse.ArgumentParser(description="Batch-convert a folder of documents to MP3 with Kokoro.")
    ap.add_argument("input", type=Path, help="File or folder to convert (folders are recursive)")
    ap.add_argument("--out", type=Path, default=Path("psyonvox-out"), help="Output folder (mirrors input structure)")
    ap.add_argument("--voice", default="af_heart", help="Kokoro voice id (default: af_heart)")
    ap.add_argument("--speed", type=float, default=1.0, help="Speaking speed (default: 1.0)")
    ap.add_argument("--bitrate", type=int, default=64, help="MP3 bitrate in kbps (default: 64)")
    ap.add_argument("--resume", dest="resume", action="store_true", default=True, help="Skip already-converted files (default)")
    ap.add_argument("--no-resume", dest="resume", action="store_false", help="Reconvert everything")
    ap.add_argument("--include-code", action="store_true", help="Read code blocks instead of skipping (batch treats input as prose; kept for parity)")
    ap.add_argument("--no-strip-junk", dest="strip_junk", action="store_false", default=True, help="Do not strip URLs/citations")
    ap.add_argument("--no-spell-acronyms", dest="spell", action="store_false", default=True, help="Do not spell out unknown acronyms")
    args = ap.parse_args()

    root: Path = args.input
    if not root.exists():
        print(f"error: {root} does not exist")
        return 2

    files = list(iter_files(root))
    if not files:
        print("No supported files found (.txt .md .pdf .docx .pptx .epub).")
        return 1

    d = load_dict()
    out_root: Path = args.out
    manifest = load_manifest(out_root)

    # Load the model once (heavy import; do it after arg parsing / --help).
    try:
        from kokoro import KPipeline  # type: ignore
    except ImportError:
        print("error: the 'kokoro' package is required — install with: pip install kokoro soundfile")
        print("System deps: espeak-ng (phonemizer fallback) and ffmpeg (MP3 encoding). See README.md.")
        return 2

    pipeline = KPipeline(lang_code=lang_code_for(args.voice))
    base = root if root.is_dir() else root.parent

    done = skipped = failed = 0
    for path in files:
        rel = path.relative_to(base)
        out_path = (out_root / rel).with_suffix(".mp3")
        h = file_hash(path)
        if args.resume and manifest.get(h) and out_path.exists():
            print(f"skip  {rel}  (already converted)")
            skipped += 1
            continue
        try:
            print(f"read  {rel}")
            raw = extract(path)
            spoken = normalize_for_speech(raw, d, args.strip_junk, args.spell)
            if not spoken.strip():
                print(f"warn  {rel}  (no readable text — skipped; scanned PDF?)")
                failed += 1
                continue
            audio = synthesize(pipeline, spoken, args.voice, args.speed)
            write_mp3(audio, out_path, args.bitrate)
            manifest[h] = str(rel.with_suffix(".mp3"))
            save_manifest(out_root, manifest)
            print(f"done  {out_path}")
            done += 1
        except Exception as e:  # noqa: BLE001 — keep going on the next file
            print(f"FAIL  {rel}: {e}")
            failed += 1

    print(f"\nDone. converted={done} skipped={skipped} failed={failed}  ->  {out_root}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
