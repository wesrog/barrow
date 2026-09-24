import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/barrow/" : "/",
  plugins: [react()],
  server: { port: Number(process.env.PORT) || 5197, strictPort: true },
  // Two pages: the game, and the asset viewer at /viewer.html.
  build: { rollupOptions: { input: { main: page("index.html"), viewer: page("viewer.html") } } },
});
