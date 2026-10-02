import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:3080", changeOrigin: false },
      "/health": { target: "http://127.0.0.1:3080", changeOrigin: false },
    },
  },
  build: { sourcemap: false },
});
