import { defineConfig } from "vite";

// Relative base: the built page works from any folder on any static host.
export default defineConfig({
  base: "./",
  build: { target: "es2022" },
});
