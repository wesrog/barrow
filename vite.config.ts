import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/barrow/" : "/",
  plugins: [react()],
  server: { port: Number(process.env.PORT) || 5197, strictPort: true },
});
