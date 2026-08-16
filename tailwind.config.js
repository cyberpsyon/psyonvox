/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0A1220",
        surface: "#141C2E",
        border: "#243149",
        text: "#E6EDF5",
        muted: "#8A93A6",
        accent: "#25C2A0",
        "accent-bright": "#3DDC97",
      },
      fontFamily: {
        sans: [
          "Inter",
          "IBM Plex Sans",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};
