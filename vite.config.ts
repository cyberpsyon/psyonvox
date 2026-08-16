import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// kokoro-js / @huggingface/transformers pull in onnxruntime-web which ships large
// prebuilt binaries; excluding from optimizeDeps avoids esbuild choking on them.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["kokoro-js", "@huggingface/transformers", "onnxruntime-web"],
  },
  worker: {
    format: "es",
  },
  build: {
    target: "esnext",
  },
});
