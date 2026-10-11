import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API (docs/API.md) runs on :8000 (`make api-dev`); the dev server proxies /api to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
