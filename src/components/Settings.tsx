import { useState } from "react";
import type { SpeechOptions } from "../lib/pronounce";

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 accent-[#25C2A0]"
      />
      <span>
        <span className="text-text">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}

export function Settings({
  opts,
  onOpts,
  includeCode,
  onIncludeCode,
  userTerms,
  onAddTerm,
  onRemoveTerm,
}: {
  opts: SpeechOptions;
  onOpts: (o: SpeechOptions) => void;
  includeCode: boolean;
  onIncludeCode: (v: boolean) => void;
  userTerms: Record<string, string>;
  onAddTerm: (term: string, say: string) => void;
  onRemoveTerm: (term: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [say, setSay] = useState("");

  const add = () => {
    const t = term.trim();
    const s = say.trim();
    if (!t || !s) return;
    onAddTerm(t, s);
    setTerm("");
    setSay("");
  };

  return (
    <section className="mb-6 rounded-lg border border-border bg-surface">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold"
      >
        <span>Settings — pronunciation &amp; reading</span>
        <span className="font-mono text-xs text-muted">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="border-t border-border px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Toggle
              label="Skip junk"
              hint="URLs, inline citations, footnote markers"
              checked={opts.stripJunk}
              onChange={(v) => onOpts({ ...opts, stripJunk: v })}
            />
            <Toggle
              label="Spell out acronyms"
              hint="Unknown all-caps read letter-by-letter"
              checked={opts.spellUnknownAcronyms}
              onChange={(v) => onOpts({ ...opts, spellUnknownAcronyms: v })}
            />
            <Toggle
              label="Read code blocks"
              hint="Off = announce “code block” and skip"
              checked={includeCode}
              onChange={onIncludeCode}
            />
          </div>

          <div className="mt-5">
            <h4 className="mb-2 font-mono text-xs uppercase tracking-wide text-muted">
              Custom pronunciations
            </h4>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Term (e.g. Kubernetes)"
                className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
              />
              <span className="text-muted">→</span>
              <input
                value={say}
                onChange={(e) => setSay(e.target.value)}
                placeholder="Say it as (e.g. koo-ber-net-eez)"
                onKeyDown={(e) => e.key === "Enter" && add()}
                className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
              />
              <button
                onClick={add}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:bg-accent-bright"
              >
                Add
              </button>
            </div>

            {Object.keys(userTerms).length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {Object.entries(userTerms).map(([t, s]) => (
                  <li
                    key={t}
                    className="flex items-center gap-2 rounded-md border border-border bg-bg px-2 py-1 text-sm"
                  >
                    <span className="font-mono text-xs">
                      {t} → {s}
                    </span>
                    <button
                      onClick={() => onRemoveTerm(t)}
                      aria-label={`Remove ${t}`}
                      className="text-muted hover:text-red-400"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted">
              Overrides apply to speech only — the on-screen text is unchanged. The
              base dictionary already covers NIST, ISO, CVE, SIEM, and more.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
