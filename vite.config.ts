import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

// 手動建構 ES Module 環境下的 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    // 只從 index.html 掃描依賴，避免掃到 TTS/ 裡 GPT-SoVITS 自帶的網頁檔而報錯
    optimizeDeps: {
      entries: ['index.html'],
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      // 不監看 TTS/（上萬個 Python 檔），減少 CPU 與記憶體占用
      // 11/10：也不監看工作桌、logs（工坊寫檔案會讓桌寵畫面整頁重新載入，打遊戲時會頓一下）
      watch:
        process.env.DISABLE_HMR === 'true' ? null : { ignored: ['**/TTS/**', '**/data/**', '**/西雅的工作桌/**', '**/logs/**', '**/voice-files/**', '**/scripts/**'] },
    },
  };
});