import { defineConfig } from 'vite';

// GitHub Pages のサブパス（/minutes-studio/）でも、ほかの場所でも動くよう相対パスで出力する
export default defineConfig({
  base: './',
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 2000 },
});
