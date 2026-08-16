// Canonical Kokoro-82M v1.0 voice roster. Ids are stable and match the ONNX
// model's voice pack. The picker exposes all of them; af_heart is the default.
export type Voice = {
  id: string;
  label: string;
  gender: "Female" | "Male";
  region: "US" | "UK";
};

export const DEFAULT_VOICE = "af_heart";

export const VOICES: Voice[] = [
  // American Female (af_)
  { id: "af_heart", label: "Heart", gender: "Female", region: "US" },
  { id: "af_alloy", label: "Alloy", gender: "Female", region: "US" },
  { id: "af_aoede", label: "Aoede", gender: "Female", region: "US" },
  { id: "af_bella", label: "Bella", gender: "Female", region: "US" },
  { id: "af_jessica", label: "Jessica", gender: "Female", region: "US" },
  { id: "af_kore", label: "Kore", gender: "Female", region: "US" },
  { id: "af_nicole", label: "Nicole", gender: "Female", region: "US" },
  { id: "af_nova", label: "Nova", gender: "Female", region: "US" },
  { id: "af_river", label: "River", gender: "Female", region: "US" },
  { id: "af_sarah", label: "Sarah", gender: "Female", region: "US" },
  { id: "af_sky", label: "Sky", gender: "Female", region: "US" },
  // American Male (am_)
  { id: "am_adam", label: "Adam", gender: "Male", region: "US" },
  { id: "am_echo", label: "Echo", gender: "Male", region: "US" },
  { id: "am_eric", label: "Eric", gender: "Male", region: "US" },
  { id: "am_fenrir", label: "Fenrir", gender: "Male", region: "US" },
  { id: "am_liam", label: "Liam", gender: "Male", region: "US" },
  { id: "am_michael", label: "Michael", gender: "Male", region: "US" },
  { id: "am_onyx", label: "Onyx", gender: "Male", region: "US" },
  { id: "am_puck", label: "Puck", gender: "Male", region: "US" },
  { id: "am_santa", label: "Santa", gender: "Male", region: "US" },
  // British Female (bf_)
  { id: "bf_alice", label: "Alice", gender: "Female", region: "UK" },
  { id: "bf_emma", label: "Emma", gender: "Female", region: "UK" },
  { id: "bf_isabella", label: "Isabella", gender: "Female", region: "UK" },
  { id: "bf_lily", label: "Lily", gender: "Female", region: "UK" },
  // British Male (bm_)
  { id: "bm_daniel", label: "Daniel", gender: "Male", region: "UK" },
  { id: "bm_fable", label: "Fable", gender: "Male", region: "UK" },
  { id: "bm_george", label: "George", gender: "Male", region: "UK" },
  { id: "bm_lewis", label: "Lewis", gender: "Male", region: "UK" },
];

export function voiceLabel(id: string): string {
  const v = VOICES.find((x) => x.id === id);
  return v ? `${v.label} (${v.region} ${v.gender})` : id;
}
