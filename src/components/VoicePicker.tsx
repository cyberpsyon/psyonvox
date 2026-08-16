import { VOICES } from "../lib/voices";

const GROUPS: { label: string; region: "US" | "UK"; gender: "Female" | "Male" }[] =
  [
    { label: "American · Female", region: "US", gender: "Female" },
    { label: "American · Male", region: "US", gender: "Male" },
    { label: "British · Female", region: "UK", gender: "Female" },
    { label: "British · Male", region: "UK", gender: "Male" },
  ];

export function VoicePicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">Voice</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-bg px-2 py-1.5 text-text outline-none focus:border-accent disabled:opacity-50"
      >
        {GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {VOICES.filter((v) => v.region === g.region && v.gender === g.gender).map(
              (v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                  {v.id === "af_heart" ? " ★" : ""}
                </option>
              ),
            )}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
