/**
 * Конфигурация сборки.
 * - Обычная сборка (`npm run build`) → dist/ для GitHub Pages (относительные пути, base './').
 * - `SINGLEFILE=1 npm run build` → один index.html со встроенными скриптами (для предпросмотра).
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

const singleFile = process.env.SINGLEFILE === "1";

export default defineConfig({
  base: "./",
  plugins: singleFile ? [react(), viteSingleFile()] : [react()],
  build: { outDir: singleFile ? "dist-single" : "dist" },
});
