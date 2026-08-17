import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { Token } from "marked";

// Format libraries are dynamically imported so each one downloads only when a
// file of that type is actually opened — keeps the initial bundle small.
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjs, workerMod] = await Promise.all([
        import("pdfjs-dist"),
        // Vite resolves the pdf.js worker as a dedicated worker bundle.
        import("pdfjs-dist/build/pdf.worker.mjs?worker"),
      ]);
      pdfjs.GlobalWorkerOptions.workerPort = new workerMod.default();
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export type BlockKind = "heading" | "text" | "code" | "table";
export type Block = { kind: BlockKind; text: string };

export type ExtractResult = {
  blocks: Block[];
  text: string; // flattened, for word count / preview / scanned check
  kind: "pdf" | "markdown" | "text" | "docx" | "pptx" | "epub";
  likelyScanned?: boolean;
};

export const ACCEPT = ".pdf,.md,.markdown,.txt,.docx,.pptx,.epub";

export async function extractFile(file: File): Promise<ExtractResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return extractPdf(file);
  if (name.endsWith(".docx")) return extractDocx(file);
  if (name.endsWith(".pptx")) return extractPptx(file);
  if (name.endsWith(".epub")) return extractEpub(file);
  if (name.endsWith(".md") || name.endsWith(".markdown")) {
    const blocks = await markdownBlocks(await file.text());
    return { blocks, text: flatten(blocks), kind: "markdown" };
  }
  const blocks = plainBlocks(cleanText(await file.text()));
  return { blocks, text: flatten(blocks), kind: "text" };
}

// ---------- Word (.docx) ----------
async function extractDocx(file: File): Promise<ExtractResult> {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({
    arrayBuffer: await file.arrayBuffer(),
  });
  const blocks = plainBlocks(cleanText(value));
  return { blocks, text: flatten(blocks), kind: "docx" };
}

// ---------- PowerPoint (.pptx) ----------
async function extractPptx(file: File): Promise<ExtractResult> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNum(a) - slideNum(b));
  const parser = new DOMParser();
  const blocks: Block[] = [];
  for (let i = 0; i < slideNames.length; i++) {
    const xml = await zip.file(slideNames[i])!.async("string");
    const doc = parser.parseFromString(xml, "application/xml");
    const runs = Array.from(doc.getElementsByTagName("a:t"))
      .map((n) => n.textContent ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    blocks.push({ kind: "heading", text: `Slide ${i + 1}` });
    if (runs) blocks.push({ kind: "text", text: runs });
  }
  return { blocks, text: flatten(blocks), kind: "pptx" };
}

function slideNum(name: string): number {
  return Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
}

// ---------- EPUB ----------
async function extractEpub(file: File): Promise<ExtractResult> {
  // epubjs types are loose; treat the module as dynamic.
  const mod = (await import("epubjs")) as unknown as { default: (input: ArrayBuffer) => EpubBook };
  const book = mod.default(await file.arrayBuffer());
  await book.ready;
  const blocks: Block[] = [];
  for (const item of book.spine.spineItems) {
    try {
      const doc: Document = await item.load(book.load.bind(book));
      for (const el of Array.from(doc.body?.querySelectorAll("h1,h2,h3,h4,p,li") ?? [])) {
        const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!t) continue;
        blocks.push({ kind: /^h[1-4]$/i.test(el.tagName) ? "heading" : "text", text: t });
      }
    } catch {
      // skip an unreadable section rather than fail the whole book
    } finally {
      item.unload?.();
    }
  }
  return { blocks, text: flatten(blocks), kind: "epub" };
}

type EpubBook = {
  ready: Promise<unknown>;
  load: (path: string) => unknown;
  spine: { spineItems: EpubItem[] };
};
type EpubItem = {
  load: (fn: (path: string) => unknown) => Promise<Document>;
  unload?: () => void;
};

function flatten(blocks: Block[]): string {
  return blocks.map((b) => b.text).join("\n\n");
}

// ---------- Markdown: use the real token structure ----------
async function markdownBlocks(md: string): Promise<Block[]> {
  const { marked } = await import("marked");
  const tokens = marked.lexer(md);
  const blocks: Block[] = [];
  const walk = (toks: Token[]) => {
    for (const t of toks) {
      switch (t.type) {
        case "heading":
          blocks.push({ kind: "heading", text: cleanInline(t.text) });
          break;
        case "paragraph":
          blocks.push({ kind: "text", text: cleanInline(t.text) });
          break;
        case "text":
          if ("text" in t && t.text) blocks.push({ kind: "text", text: cleanInline(t.text) });
          break;
        case "code":
          blocks.push({ kind: "code", text: t.text });
          break;
        case "table":
          blocks.push({ kind: "table", text: t.raw });
          break;
        case "blockquote":
          if ("tokens" in t && t.tokens) walk(t.tokens);
          break;
        case "list":
          for (const item of t.items) {
            blocks.push({ kind: "text", text: cleanInline(item.text) });
          }
          break;
        default:
          break;
      }
    }
  };
  walk(tokens);
  return blocks;
}

function cleanInline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/\*\*|__|\*|_/g, "") // emphasis marks
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links -> label
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- Plain text / PDF-derived text: heuristic headings ----------
function plainBlocks(text: string): Block[] {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const blocks: Block[] = [];
  for (const line of lines) {
    if (looksLikeHeading(line)) blocks.push({ kind: "heading", text: line });
    else blocks.push({ kind: "text", text: line });
  }
  return blocks;
}

function looksLikeHeading(line: string): boolean {
  if (line.length > 64 || /[.!?]$/.test(line)) return false;
  if (!/[A-Za-z]/.test(line)) return false;
  const words = line.split(/\s+/).length;
  if (words > 10) return false;
  if (/^\d+(\.\d+)*\s+\S/.test(line)) return true; // "1.2 Access Control"
  if (line === line.toUpperCase()) return true; // ALL CAPS
  return words <= 8;
}

// ---------- PDF ----------
async function extractPdf(file: File): Promise<ExtractResult> {
  const pdfjsLib = await loadPdfjs();
  const data = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const pageTexts: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items
      .filter((i): i is TextItem => "str" in i && i.str.trim().length > 0)
      .map((i) => ({
        x: i.transform[4],
        y: i.transform[5],
        w: i.width,
        str: i.str,
      }));
    if (items.length === 0) {
      pageTexts.push("");
      continue;
    }
    pageTexts.push(readColumns(items, viewport.width));
  }

  const joined = pageTexts.join("\n\n");
  const cleaned = cleanText(stripPdfNoise(joined));
  const likelyScanned = cleaned.replace(/\s/g, "").length < 20 && doc.numPages > 0;
  return {
    blocks: plainBlocks(cleaned),
    text: cleaned,
    kind: "pdf",
    likelyScanned,
  };
}

type PdfItem = { x: number; y: number; w: number; str: string };

/**
 * Detect a two-column layout and read left column fully before the right.
 * Falls back to single-column when there's no clear vertical gutter.
 */
function readColumns(items: PdfItem[], pageWidth: number): string {
  const center = pageWidth / 2;
  const margin = pageWidth * 0.04;
  let left = 0;
  let right = 0;
  let span = 0;
  for (const it of items) {
    const start = it.x;
    const end = it.x + it.w;
    if (end < center + margin && start < center - margin) left++;
    else if (start > center - margin && end > center + margin && start >= center - margin)
      right++;
    if (start < center - margin && end > center + margin) span++;
  }
  const twoCol =
    span < items.length * 0.08 &&
    left > items.length * 0.2 &&
    right > items.length * 0.2;

  if (!twoCol) return linesToText(items);

  const leftItems = items.filter((it) => it.x + it.w / 2 < center);
  const rightItems = items.filter((it) => it.x + it.w / 2 >= center);
  return `${linesToText(leftItems)}\n${linesToText(rightItems)}`;
}

/** Group items into visual lines by y, order top-to-bottom, left-to-right. */
function linesToText(items: PdfItem[]): string {
  const lines: { y: number; parts: PdfItem[] }[] = [];
  for (const it of items) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < 3);
    if (line) line.parts.push(it);
    else lines.push({ y: it.y, parts: [it] });
  }
  lines.sort((a, b) => b.y - a.y);
  return lines
    .map((l) =>
      l.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str)
        .join("")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

/** Remove page numbers and obvious running headers/footers. */
function stripPdfNoise(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (/^(page\s+)?\d{1,4}(\s*[/of]{1,2}\s*\d{1,4})?$/i.test(t)) return false;
      return true;
    })
    .join("\n");
}

/**
 * Normalize whitespace, rejoin hyphenated line breaks, and join wrapped lines
 * while preserving paragraph breaks.
 */
export function cleanText(raw: string): string {
  let t = raw.replace(/\r\n?/g, "\n");
  t = t.replace(/(\w)-\n(\w)/g, "$1$2"); // dehyphenate line breaks
  t = t.replace(/\n{3,}/g, "\n\n"); // collapse to paragraph breaks
  t = t.replace(/([^\n.!?:;])\n(?!\n)(\S)/g, "$1 $2"); // join wrapped lines
  t = t.replace(/[ \t]{2,}/g, " ");
  return t.trim();
}
