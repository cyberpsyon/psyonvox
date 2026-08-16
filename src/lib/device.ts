// Device + dtype are linked per the spec — pick the pair per device, never a
// single global default.
//   wasm   -> q8   (~90 MB, reliable everywhere)
//   webgpu -> fp32 (~330 MB, quantized dtypes are unreliable on WebGPU)
export type Device = "wasm" | "webgpu";
export type Dtype = "q8" | "q4" | "fp32";

export type EnginePair = { device: Device; dtype: Dtype };

export type DevicePreference = "auto" | "wasm" | "webgpu" | "wasm-lite";

/** True when the browser merely advertises a WebGPU entry point (not proof it works). */
export function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator && !!navigator.gpu;
}

/**
 * Real capability probe: `navigator.gpu` can exist while `requestAdapter()`
 * still returns null (no adapter / disabled by flags). Only a non-null adapter
 * means WebGPU will actually initialize.
 */
export async function probeWebGPU(): Promise<boolean> {
  if (!hasWebGPU()) return false;
  try {
    const gpu = navigator.gpu as { requestAdapter(): Promise<unknown> };
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

/** Approximate one-time model download size for a given pair, in MB. */
export function approxDownloadMB(pair: EnginePair): number {
  if (pair.dtype === "fp32") return 330;
  if (pair.dtype === "q4") return 45;
  return 90; // q8
}

/**
 * Resolve a user preference into a concrete device/dtype pair. For "auto",
 * pass the probed capability (`probeWebGPU()` result); it defaults to the weak
 * sync check only when a probe result isn't supplied yet.
 */
export function resolvePair(
  pref: DevicePreference,
  gpuAvailable: boolean = hasWebGPU(),
): EnginePair {
  switch (pref) {
    case "webgpu":
      return { device: "webgpu", dtype: "fp32" };
    case "wasm":
      return { device: "wasm", dtype: "q8" };
    case "wasm-lite":
      return { device: "wasm", dtype: "q4" };
    case "auto":
    default:
      return gpuAvailable
        ? { device: "webgpu", dtype: "fp32" }
        : { device: "wasm", dtype: "q8" };
  }
}

export function pairLabel(pref: DevicePreference, pair: EnginePair): string {
  const base = `${pair.device} · ${pair.dtype} · ~${approxDownloadMB(pair)} MB`;
  return pref === "auto" ? `Auto (${base})` : base;
}
