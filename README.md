<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/c8dcb5ba-074e-45d8-89e1-fc83a8e05322

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## 搬到另一台電腦

1. 先關掉桌寵，在專案資料夾執行 `npm run pack:migrate`，桌面會出現 `桌寵搬家包-日期.zip`。
   內容：專案程式碼（含 git 歷史）、`.env`（API 金鑰）、`data/`（立繪、事件日記、心情好感度），
   以及 Electron 裡的瀏覽器端記憶（喜好關鍵字、聊天紀錄、摸魚手帳、設定）。
   不包含 `node_modules` 和 `TTS/`（GPT-SoVITS 語音包請另外搬）。
2. 新電腦先安裝 Node.js，解壓縮後雙擊 `還原桌寵.cmd`：會還原到「桌面\桌寵」、放回瀏覽器端記憶，並執行 `npm install`。
   想放別的位置或覆蓋既有資料夾，可用 `scripts/restore-migration.ps1` 的 `-Target`、`-Force` 參數（覆蓋前會自動備份）。
3. 啟動 GPT-SoVITS（127.0.0.1:9880）後執行 `npm run electron:dev`。路徑不同時在 `.env` 設定 `SOVITS_REF_AUDIO` 等。

⚠️ 搬家包裡有 API 金鑰，請用隨身碟或私人雲端搬，不要分享。
