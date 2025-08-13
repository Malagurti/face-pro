import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  resolve: {
    alias: {
      "@face-pro/proof-of-life": fileURLToPath(
        new URL("../../packages/proof-of-life/src/index.ts", import.meta.url)
      )
    }
  }
});


