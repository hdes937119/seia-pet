/**
 * 回溯西雅改的程式（主人雙擊「回溯西雅改的程式.bat」）
 *   npx tsx scripts/self/rollback.ts            → 列出最近的修改，選一個，回到那次修改之前
 *   npx tsx scripts/self/rollback.ts <編號或id> → 直接回溯
 * 回溯前會先把現在的樣子再備份一份（也記在 data/self-edits.jsonl，可以再回溯回來）。
 * 只動程式碼（不碰 data/ 記憶、node_modules、.env、工作桌）。改完要重開桌寵（restart-pet.bat）。
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { unpackTarGz, packTarGz } from '../../server/tarball';
import { selfFiles, type SelfEdit } from '../../server/selfAccess';

const root = process.cwd();
const editLog = path.join(root, 'data', 'self-edits.jsonl');
const backupDir = path.join(root, 'logs', 'self-backups');
const pad = (n: number) => String(n).padStart(2, '0');
const when = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function load(): SelfEdit[] {
  try {
    return fs
      .readFileSync(editLog, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

async function ask(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(q, (a) => (rl.close(), r(a.trim()))));
}

async function main() {
  if (!fs.existsSync(path.join(root, 'server.ts'))) {
    console.log('要在桌寵資料夾裡執行（請雙擊「回溯西雅改的程式.bat」）');
    return;
  }
  const all = load();
  const list = all.slice(-15).reverse();
  if (!list.length) {
    console.log('還沒有任何修改紀錄（data/self-edits.jsonl 是空的）。');
    return;
  }
  console.log('最近的修改（數字小＝比較新）：');
  list.forEach((e, i) => {
    const files = [...e.changed, ...e.added, ...e.deleted];
    const ok = fs.existsSync(path.join(root, e.backup));
    console.log(`  ${i + 1}. ${when(e.at)} ${e.type === 'rollback' ? '［回溯］' : ''}「${e.title}」 改${e.changed.length} 增${e.added.length} 刪${e.deleted.length}：${files.slice(0, 4).join('、')}${files.length > 4 ? '…' : ''}${ok ? '' : '（備份不在這台電腦）'}`);
  });
  let pick = process.argv[2] || (await ask('\n要回到哪一次修改「之前」？輸入編號（直接按 Enter＝1，輸入 q 取消）：'));
  if (/^q/i.test(pick)) return console.log('取消了。');
  if (!pick) pick = '1';
  const target = /^\d+$/.test(pick) ? list[Number(pick) - 1] : all.find((e) => e.id === pick);
  if (!target) return console.log('沒有這個編號。');
  const tarPath = path.join(root, target.backup);
  if (!fs.existsSync(tarPath)) return console.log(`找不到備份 ${target.backup}（可能是在另一台電腦改的，或太舊被清掉了）。`);
  const snap = unpackTarGz(fs.readFileSync(tarPath), { maxFiles: 50000, maxBytes: 1024 * 1024 * 1024 });

  // 先把現在的樣子備份起來
  const cur = selfFiles(root);
  const d = new Date();
  const id = `rollback-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, `${id}.tar.gz`), packTarGz(cur));

  const snapMap = new Map(snap.map((e) => [e.path, e.data]));
  const curMap = new Map(cur.map((e) => [e.path, e.data]));
  const restored: string[] = [];
  const removed: string[] = [];
  const recreated: string[] = [];
  for (const [p, data] of snapMap) {
    const dest = path.join(root, p);
    if (!path.resolve(dest).startsWith(path.resolve(root) + path.sep)) continue;
    const now = curMap.get(p);
    if (now && now.equals(data)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
    (now ? restored : recreated).push(p);
  }
  for (const p of curMap.keys()) {
    if (snapMap.has(p)) continue;
    fs.rmSync(path.join(root, p), { force: true });
    removed.push(p);
  }
  const entry: SelfEdit = { at: Date.now(), id, title: `回溯到「${target.title}」之前`, changed: restored, added: recreated, deleted: removed, backup: `logs/self-backups/${id}.tar.gz`, type: 'rollback' };
  fs.mkdirSync(path.dirname(editLog), { recursive: true });
  fs.appendFileSync(editLog, `${JSON.stringify(entry)}\n`);
  console.log(`\n✅ 回到「${target.title}」（${when(target.at)}）之前了：還原 ${restored.length}、補回 ${recreated.length}、刪掉 ${removed.length} 個檔案。`);
  for (const p of [...restored, ...recreated, ...removed].slice(0, 30)) console.log(`   ${p}`);
  console.log('\n回溯前的樣子也備份了，想反悔就再跑一次、選最上面那筆［回溯］。');
  console.log('畫面的部分會馬上變回來；後端要重開桌寵才會生效（restart-pet.bat）。');
}

main().catch((e) => console.log(`回溯失敗：${e?.message || e}`));
