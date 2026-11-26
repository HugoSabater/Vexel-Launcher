import { defineConfig } from "vite";

export default defineConfig({
  base: "/mc-launcher-rust/",
  build: {
    outDir: "dist",
    assetsDir: "assets",
  },
});
