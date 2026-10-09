import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

const apiPort = process.env.PORT ?? "3000";

export default defineConfig({
  plugins: [preact()],
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: {
    // In development the API runs separately; in production it serves the built PWA itself.
    proxy: {
      "/api": `http://localhost:${apiPort}`,
      "/cards": `http://localhost:${apiPort}`,
    },
  },
});
