import base from "../../shared/pronunciations.json";

// Text normalization for SPEECH only — display text is never modified. Applied
// per sentence before it's handed to the Kokoro worker. The base dictionary is
// the shared JSON (also read by the Python batch script); user overrides from
// Settings are merged on top.

export type Dict = {
  version: number;
  patterns: { re: string; flags: string; to: string }[];
  terms: Record<string, string>;
};

export type SpeechOptions = {
  spellUnknownAcronyms: boolean; // GRC -> G-R-C when not in the dictionary
  stripJunk: boolean; // URLs, inline citations, footnote markers
};

export const DEFAULT_SPEECH_OPTIONS: SpeechOptions = {
  spellUnknownAcronyms: true,
  stripJunk: true,
};

/** Merge base dictionary with user-added term overrides. */
export function mergeDict(userTerms: Record<string, string>): Dict {
  const b = base as Dict;
  return { ...b, terms: { ...b.terms, ...userTerms } };
}

export function baseDict(): Dict {
  return base as Dict;
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const BRACKET_CITATION_RE = /\[\s*\d+(?:\s*[-,]\s*\d+)*\s*\]/g; // [12], [3-5], [1,2]
const PAREN_CITATION_RE = /\((?:[A-Z][A-Za-z'-]+(?:\s+(?:et al\.?|and|&)\s+[A-Z][A-Za-z'-]+)*,?\s+)?\d{4}[a-z]?\)/g; // (Smith, 2020)
const FOOTNOTE_MD_RE = /\[\^\w+\]/g; // [^1]
const SUPERSCRIPT_RE = /[¹²³⁰-⁹]+/g; // ¹²³ …

function stripJunk(text: string): string {
  return text
    .replace(URL_RE, " ")
    .replace(FOOTNOTE_MD_RE, " ")
    .replace(BRACKET_CITATION_RE, " ")
    .replace(PAREN_CITATION_RE, " ")
    .replace(SUPERSCRIPT_RE, " ");
}

function applyDict(text: string, dict: Dict): string {
  let t = text;
  for (const p of dict.patterns) {
    try {
      t = t.replace(new RegExp(p.re, p.flags), p.to);
    } catch {
      // Skip a malformed user/base pattern rather than break all speech.
    }
  }
  // Whole-token, case-insensitive term replacement.
  const keys = Object.keys(dict.terms);
  if (keys.length > 0) {
    const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const re = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
    const lookup = new Map(keys.map((k) => [k.toUpperCase(), dict.terms[k]]));
    t = t.replace(re, (m) => lookup.get(m.toUpperCase()) ?? m);
  }
  return t;
}

// Roman numerals are common in headings ("Type II", "Phase III") and must not
// be spelled letter-by-letter.
const ROMAN = new Set([
  "II", "III", "IV", "VI", "VII", "VIII", "IX", "XI", "XII", "XIII", "XIV", "XV",
]);

/** Spell out remaining unknown all-caps acronyms: GRC -> "G-R-C". */
function spellAcronyms(text: string): string {
  return text.replace(/\b[A-Z][A-Z0-9]{1,4}\b/g, (m) =>
    ROMAN.has(m) ? m : m.split("").join("-"),
  );
}

export function normalizeForSpeech(
  text: string,
  dict: Dict,
  opts: SpeechOptions,
): string {
  let t = text;
  if (opts.stripJunk) t = stripJunk(t);
  t = applyDict(t, dict);
  if (opts.spellUnknownAcronyms) t = spellAcronyms(t);
  return t.replace(/\s{2,}/g, " ").trim();
}

/**
 * Spoken form of a segment. Code/tables are announced and their contents
 * skipped (unless `includeCode` is on for code). Everything else is normalized.
 */
export function toSpoken(
  seg: { text: string; kind: string },
  dict: Dict,
  opts: SpeechOptions,
  includeCode: boolean,
): string {
  if (seg.kind === "table") return "Table.";
  if (seg.kind === "code") {
    return includeCode ? normalizeForSpeech(seg.text, dict, opts) : "Code block.";
  }
  return normalizeForSpeech(seg.text, dict, opts) || " ";
}
