import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true },
  test: {
    // Grove's suites render the whole App in jsdom. A case that takes about
    // 0.5 s on an idle box takes 2 s or more while the merge gate runs every
    // workspace's tests at once, so the 5 s default fails on load, not on
    // behavior (batch 2127).
    testTimeout: 30_000,
  },
});
