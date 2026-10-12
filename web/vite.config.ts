import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API (docs/API.md) runs on :8000 (`make api-dev`); the dev server proxies /api to it.
export default defineConfig({
  plugins: [react()],
  // three.js is only imported lazily; pre-bundle it at server start so the first dynamic import never
  // triggers a dependency re-optimisation (and a page reload) in the middle of a session
  optimizeDeps: { include: ["three", "three/examples/jsm/geometries/RoundedBoxGeometry.js"] },
  // the lazily loaded 3D chunk (three.js) is about 530 kB raw / 134 kB gzip by design (budget 170 kB gzip)
  build: { chunkSizeWarningLimit: 600 },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
