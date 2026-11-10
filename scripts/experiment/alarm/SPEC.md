# 任務：防發呆鬧鐘（單一 index.html）

做一個離線網頁 `index.html`（HTML、CSS、原生 JavaScript 全部寫在這一個檔案裡，不用任何外部資源）。

## 功能
1. **兩種模式**：倒數（輸入分、秒）和定時（輸入幾點幾分，到那個時間響；如果那個時間今天已經過了，就算明天的）。
2. **提醒文字**：可以自己輸入；時間到時，畫面要顯示這段文字。如果有 `window.seia`，就呼叫 `window.seia.say(文字)`（它會回傳 Promise）。沒有 `window.seia` 時，網頁也要能正常運作。
3. **開始／暫停／恢復**：按「開始」後開始計時；計時中可以按「暫停」，時間會停住，按鈕文字變成「恢復」；再按一次就繼續，文字變回「暫停」。
4. **時間到之後**：可以重新設定，再開始下一輪（「開始」按鈕不能一直停在不能按的狀態）。
5. **防呆**：時間是 0 或亂填時不能開始，或者要提示；畫面上不能出現 NaN 或負數。
6. **外觀**：深色星空風格，有一點亮晶晶的動畫。動畫和音效都是加分項目，要用瀏覽器可能沒有的 API（AudioContext 等）時，請用 try/catch 包起來，不能讓計時壞掉。

## 元素 id（驗收腳本會用這些 id 操作，一定要有）
- `#mode-countdown`、`#mode-clock`：radio，name="mode"
- `#minutes`、`#seconds`：倒數的分、秒
- `#clock-time`：`<input type="time">`，值的格式是 "HH:MM"
- `#message`：提醒文字
- `#start`：開始
- `#pause`：暫停／恢復（同一顆按鈕）
- `#display`：剩下的時間，格式是 MM:SS（一小時以上用 HH:MM:SS）

## 驗收
- 資料夾裡的 `accept.mjs` 是驗收腳本：`node accept.mjs`（用 jsdom 跑，真的會等秒數，大約 15 秒）。
- **不要修改 accept.mjs。** 要一直改 index.html，直到 `node accept.mjs` 全部通過為止。
- 你也可以自己寫別的測試。
- 做完寫 `RESULT.md`：做了什麼、最後一次 `node accept.mjs` 的完整輸出。
