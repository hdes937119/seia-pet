// ==UserScript==
// @name         哈基米桌寵：Gemini 網頁對話連動
// @namespace    gemini-desktop-pet
// @version      1.0
// @description  你在 Gemini 網頁版每問完一題，就把「問題＋回答」傳給自己電腦上的桌寵（只傳到 127.0.0.1，不會傳到別的地方）
// @match        https://gemini.google.com/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ENDPOINT = 'http://127.0.0.1:3000/api/gemini-web/ingest';
  // 回答多久沒再變動，才算 Gemini 講完了
  const STABLE_MS = 3500;

  // Gemini 網頁的結構（Google 改版時可能要跟著改這裡）
  const SEL = {
    question: 'user-query',
    questionText: '.query-text',
    answer: 'model-response',
    answerText: 'message-content',
    // Gemini 還在回答時會出現的「停止」按鈕
    stopButton: 'button[aria-label*="Stop" i], button[aria-label*="停止"]',
  };

  const sent = new Set();
  const textOf = (el) => (el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : '');
  const key = (q, a) => q.slice(0, 120) + '|' + a.slice(0, 120);

  function pairs() {
    const qs = [...document.querySelectorAll(SEL.question)];
    const as = [...document.querySelectorAll(SEL.answer)];
    const n = Math.min(qs.length, as.length);
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({
        q: textOf(qs[i].querySelector(SEL.questionText) || qs[i]),
        a: textOf(as[i].querySelector(SEL.answerText) || as[i]),
      });
    }
    return { out, questions: qs.length, answers: as.length };
  }

  // 打開舊對話時，畫面上本來就有的問答不要一次全送出去
  let ready = false;
  function markExisting() {
    for (const p of pairs().out) if (p.q && p.a) sent.add(key(p.q, p.a));
    ready = true;
  }
  setTimeout(markExisting, 4000);

  let lastUrl = location.href;
  let lastAnswer = '';
  let lastChange = Date.now();

  setInterval(() => {
    // 切換到別的對話 → 重新標記畫面上已經有的
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      ready = false;
      setTimeout(markExisting, 4000);
      return;
    }
    if (!ready) return;

    const { out, questions, answers } = pairs();
    // 剛送出新問題、回答還沒出現 → 等一下
    if (!out.length || questions !== answers) return;
    if (document.querySelector(SEL.stopButton)) return; // 還在回答

    const { q, a } = out[out.length - 1];
    if (!q || !a) return;
    if (a !== lastAnswer) {
      lastAnswer = a;
      lastChange = Date.now();
      return;
    }
    if (Date.now() - lastChange < STABLE_MS) return;

    const k = key(q, a);
    if (sent.has(k)) return;
    sent.add(k);
    GM_xmlhttpRequest({
      method: 'POST',
      url: ENDPOINT,
      headers: { 'Content-Type': 'application/json', 'X-Gemini-Pet': '1' },
      data: JSON.stringify({ question: q, answer: a }),
      timeout: 10000,
      // 桌寵沒開的話就算了（下次問的會照常送）
      onerror: () => {},
    });
  }, 1000);
})();
