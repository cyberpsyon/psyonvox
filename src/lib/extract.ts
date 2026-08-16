import * as pdfjsLib from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { marked } from "marked";
// Vite resolves the pdf.js worker as a dedicated worker bundle (the documented
// setup — configuring the worker is a common Vite gotcha).
import PdfWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

export type ExtractResult = {
  text: string;
  kind: "pdf" | "markdown" | "text";
  /** True when a PDF had effectively no extractable text layer (likely scanned). */
  likelyScanned?: boolean;
};

export async function extractFile(file: File): Promise<ExtractResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return extractPdf(file);
  if (name.endsWith(".md") || name.endsWith(".markdown")) {
    return { text: cleanText(markdownToText(await file.text())), kind: "markdown" };
  }
  // .txt and everything else: treat as plain text.
  return { text: cleanText(await file.text()), kind: "text" };
}

async function extractPdf(file: File): Promise<ExtractResult> {
  const data = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const pageTexts: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.filter(
      (i): i is TextItem => "str" in i,
    );

    // Rebuild lines using each item's y position; items with the same y (within
    // a tolerance) belong to the same visual line.
    const lines: { y: number; parts: { x: number; str: string }[] }[] = [];
    for (const it of items) {
      const x = it.transform[4];
      const y = it.transform[5];
      const line = lines.find((l) => Math.abs(l.y - y) < 3);
      if (line) line.parts.push({ x, str: it.str });
      else lines.push({ y, parts: [{ x, str: it.str }] });
    }
    lines.sort((a, b) => b.y - a.y); // top-to-bottom
    const pageText = lines
      .map((l) =>
        l.parts
          .sort((a, b) => a.x - b.x)
          .map((p) => p.str)
          .join("")
          .trim(),
      )
      .filter(Boolean)
      .join("\n");
    pageTexts.push(pageText);
  }

  const joined = pageTexts.join("\n\n");
  const cleaned = cleanText(stripPdfNoise(joined));
  const likelyScanned = cleaned.replace(/\s/g, "").length < 20 && doc.numPages > 0;
  return { text: cleaned, kind: "pdf", likelyScanned };
}

function markdownToText(md: string): string {
  // Render to HTML then strip tags; keeps heading/paragraph breaks as newlines.
  const html = marked.parse(md, { async: false }) as string;
  const withBreaks = html
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, "\n")
    .replace(/<br\s*\/?>(?=)/gi, "\n");
  const doc = new DOMParser().parseFromString(withBreaks, "text/html");
  return doc.body.textContent ?? "";
}

/** Remove page numbers and obvious running headers/footers (MVP heuristics). */
function stripPdfNoise(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      // Bare page numbers like "12" or "Page 12" or "12 / 340".
      if (/^(page\s+)?\d{1,4}(\s*[/of]{1,2}\s*\d{1,4})?$/i.test(t)) return false;
      return true;
    })
    .join("\n");
}

/**
 * Normalize whitespace, rejoin hyphenated line breaks, and join wrapped lines
 * while preserving paragraph breaks. Keeps things conservative for the MVP;
 * multi-column reordering is Phase 3.
 */
export function cleanText(raw: string): string {
  let t = raw.replace(/\r\n?/g, "\n");

  // Rejoin words split by a hyphen at a line break: "compli-\nance" -> "compliance".
  t = t.replace(/(\w)-\n(\w)/g, "$1$2");

  // Collapse 3+ newlines into a paragraph break.
  t = t.replace(/\n{3,}/g, "\n\n");

  // Join lines that are part of the same paragraph: a newline NOT followed by
  // another newline, and not ending a sentence, becomes a space.
  t = t.replace(/([^\n.!?:;])\n(?!\n)(\S)/g, "$1 $2");

  // Collapse runs of spaces/tabs.
  t = t.replace(/[ \t]{2,}/g, " ");

  return t.trim();
}
