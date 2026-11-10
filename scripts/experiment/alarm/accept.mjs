// 防發呆鬧鐘驗收腳本（不要修改）。用法：node accept.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); } catch {
  console.log('需要 jsdom：先在這個資料夾跑 npm install jsdom'); process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? `：${extra}` : ''}`); };

function open({ seia = true } = {}) {
  const errors = [];
  const said = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Not implemented/.test(String(e?.message))) errors.push(String(e?.message || e)); });
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.alert = () => {}; w.confirm = () => true;
      w.HTMLMediaElement.prototype.play = () => Promise.resolve();
      w.HTMLMediaElement.prototype.pause = () => {};
      if (seia) w.seia = {
        say: async (t) => { said.push(String(t)); return { ok: true }; },
        notify: async () => ({ ok: true }), remind: async () => ({ ok: true, id: 'r1' }),
        reminders: async () => ({ ok: true, reminders: [] }), cancelReminder: async () => ({ ok: true }),
      };
    },
  });
  const w = dom.window, d = w.document;
  const $ = (id) => d.getElementById(id);
  const set = (id, v) => { const el = $(id); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const pick = (id) => { const el = $(id); el.checked = true; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); el.checked = true; };
  const click = (id) => $(id).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const shown = () => ($('display')?.textContent || '').trim();
  const secs = () => { const n = (shown().match(/\d+/g) || []).map(Number); if (!n.length) return NaN; return n.length >= 3 ? n.at(-3) * 3600 + n.at(-2) * 60 + n.at(-1) : n.length === 2 ? n[0] * 60 + n[1] : n[0]; };
  return { dom, w, d, $, set, pick, click, shown, secs, errors, said, close: () => w.close() };
}

// 1. 元素都在
{
  const p = open();
  const ids = ['mode-countdown', 'mode-clock', 'minutes', 'seconds', 'clock-time', 'message', 'start', 'pause', 'display'];
  const miss = ids.filter((i) => !p.$(i));
  ok('1 必要的元素都在', !miss.length, miss.length ? `缺 ${miss.join(', ')}` : '');
  ok('1 打開時沒有程式錯誤', !p.errors.length, p.errors.join(' | '));
  p.close();
  if (miss.length) { console.log(`\n結果：${pass} 過、${fail} 沒過`); process.exit(1); }
}
// 2～4. 倒數、暫停、恢復、時間到
{
  const p = open();
  p.pick('mode-countdown'); p.set('minutes', '0'); p.set('seconds', '3'); p.set('message', '測試123');
  p.click('start');
  await sleep(1300);
  const s1 = p.secs();
  ok('2 開始後有在倒數', s1 >= 1 && s1 <= 2, `顯示「${p.shown()}」`);
  p.click('pause');
  const a = p.secs();
  await sleep(1600);
  const b = p.secs();
  ok('3 暫停後時間停住', a === b && a >= 1, `暫停時「${a}」、1.6 秒後「${b}」`);
  ok('3 暫停後按鈕顯示「恢復」', /恢復/.test(p.$('pause').textContent || ''), `按鈕「${(p.$('pause').textContent || '').trim()}」`);
  p.click('pause');
  ok('4 恢復後按鈕顯示「暫停」', /暫停/.test(p.$('pause').textContent || ''), `按鈕「${(p.$('pause').textContent || '').trim()}」`);
  await sleep(3500);
  ok('4 時間到有呼叫 seia.say(提醒文字)', p.said.some((t) => t.includes('測試123')), `say 收到：${JSON.stringify(p.said)}`);
  ok('4 時間到畫面有顯示提醒文字', (p.d.body.textContent || '').includes('測試123'));
  ok('4 時間到之後可以再按開始', !p.$('start').disabled && p.$('start').style.display !== 'none' && !p.$('start').hidden);
  ok('4 過程中沒有程式錯誤', !p.errors.length, p.errors.join(' | '));
  p.close();
}
// 5. 沒有 window.seia 也能跑
{
  const p = open({ seia: false });
  p.pick('mode-countdown'); p.set('minutes', '0'); p.set('seconds', '1'); p.set('message', '沒有seia');
  p.click('start');
  await sleep(2200);
  ok('5 沒有 window.seia 也能倒數到底、不出錯', !p.errors.length && (p.d.body.textContent || '').includes('沒有seia'), p.errors.join(' | '));
  p.close();
}
// 6. 定時模式（兩分鐘後，跨午夜也要對）
{
  const p = open();
  const t = new Date(Date.now() + 2 * 60_000);
  const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  p.pick('mode-clock'); p.set('clock-time', hhmm); p.set('message', '定時');
  p.click('start');
  await sleep(1300);
  const s = p.secs();
  ok('6 定時模式顯示剩下的時間合理', s >= 55 && s <= 125, `設 ${hhmm}，顯示「${p.shown()}」`);
  ok('6 定時模式沒有程式錯誤', !p.errors.length, p.errors.join(' | '));
  p.close();
}
// 7. 防呆
{
  const p = open();
  p.pick('mode-countdown'); p.set('minutes', '0'); p.set('seconds', '0'); p.set('message', 'x');
  p.click('start');
  await sleep(1200);
  const txt = p.shown();
  ok('7 時間是 0 時不會出現 NaN 或負數', !/NaN|-/.test(txt), `顯示「${txt}」`);
  p.set('minutes', 'abc'); p.set('seconds', '');
  p.click('start');
  await sleep(1200);
  ok('7 亂填時不會出現 NaN 或負數', !/NaN|-/.test(p.shown()), `顯示「${p.shown()}」`);
  p.close();
}
console.log(`\n結果：${pass} 過、${fail} 沒過`);
process.exit(fail ? 1 : 0);
