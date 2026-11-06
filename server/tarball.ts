/**
 * 最小的 tar.gz 讀寫（不裝套件）：委託的專案工作區用它在 Windows（data/commissions/<id>/ws/）和工坊 WSL 之間搬檔案。
 * 寫：ustar（長檔名用 pax 標頭）；讀：一般檔案、資料夾、GNU 長檔名（L）、pax（x）。
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

export interface TarEntry {
  path: string;
  data: Buffer;
}

function header(name: string, size: number, type: string, mtime: number): Buffer {
  const h = Buffer.alloc(512, 0);
  const put = (s: string, off: number, len: number) => Buffer.from(s, 'utf8').copy(h, off, 0, len);
  put(name, 0, 100);
  put('0000644\0', 100, 8);
  put('0001750\0', 108, 8);
  put('0001750\0', 116, 8);
  put(size.toString(8).padStart(11, '0') + '\0', 124, 12);
  put(Math.floor(mtime / 1000).toString(8).padStart(11, '0') + '\0', 136, 12);
  put('        ', 148, 8);
  put(type, 156, 1);
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i];
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}

function pad512(n: number) {
  return Buffer.alloc((512 - (n % 512)) % 512, 0);
}

function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return `${len}${body}`;
}

export function packTarGz(entries: TarEntry[], mtime = Date.now()): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const name = e.path.replace(/\\/g, '/');
    if (Buffer.byteLength(name) > 99 || /[^\x20-\x7e]/.test(name)) {
      const pax = Buffer.from(paxRecord('path', name), 'utf8');
      parts.push(header('PaxHeader/x', pax.length, 'x', mtime), pax, pad512(pax.length));
      parts.push(header(name.replace(/[^\x20-\x7e]/g, '_').slice(-99), e.data.length, '0', mtime));
    } else parts.push(header(name, e.data.length, '0', mtime));
    parts.push(e.data, pad512(e.data.length));
  }
  parts.push(Buffer.alloc(1024, 0));
  return zlib.gzipSync(Buffer.concat(parts));
}

const cstr = (b: Buffer) => {
  const i = b.indexOf(0);
  return b.subarray(0, i < 0 ? b.length : i).toString('utf8');
};

/** 解開 tar.gz（只收一般檔案；不乾淨的路徑一律丟掉） */
export function unpackTarGz(gz: Buffer, limits = { maxFiles: 2000, maxBytes: 64 * 1024 * 1024 }): TarEntry[] {
  const buf = zlib.gunzipSync(gz, { maxOutputLength: limits.maxBytes + 4 * 1024 * 1024 });
  const out: TarEntry[] = [];
  let off = 0;
  let longName = '';
  let total = 0;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    let name = cstr(h.subarray(0, 100));
    const prefix = cstr(h.subarray(345, 500));
    if (prefix && h.subarray(257, 262).toString() === 'ustar') name = `${prefix}/${name}`;
    const size = parseInt(cstr(h.subarray(124, 136)).trim() || '0', 8) || 0;
    const type = String.fromCharCode(h[156] || 48);
    off += 512;
    const data = buf.subarray(off, off + size);
    off += size + ((512 - (size % 512)) % 512);
    if (type === 'L') {
      longName = cstr(data);
      continue;
    }
    if (type === 'x') {
      const m = data.toString('utf8').match(/\d+ path=([^\n]*)\n/);
      if (m) longName = m[1];
      continue;
    }
    if (type === 'g') continue;
    if (longName) {
      name = longName;
      longName = '';
    }
    if (type !== '0' && type !== '\0' && type !== '7') continue;
    const rel = name.replace(/^\.\//, '');
    if (!safeRel(rel)) continue;
    total += size;
    if (out.length >= limits.maxFiles || total > limits.maxBytes) throw new Error('工作區太大了');
    out.push({ path: rel, data: Buffer.from(data) });
  }
  return out;
}

export function safeRel(rel: string): boolean {
  if (!rel || rel.length > 400) return false;
  if (path.isAbsolute(rel) || /^[\\/]/.test(rel) || /^[a-zA-Z]:/.test(rel)) return false;
  return !rel.split(/[\\/]/).some((s) => s === '..' || s === '');
}

/** 讀整個資料夾（相對路徑） */
export function readDirEntries(dir: string, skip: (rel: string) => boolean = () => false): TarEntry[] {
  const out: TarEntry[] = [];
  const walk = (d: string, base: string) => {
    let list: fs.Dirent[] = [];
    try {
      list = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of list) {
      const rel = base ? `${base}/${it.name}` : it.name;
      if (skip(rel)) continue;
      const full = path.join(d, it.name);
      if (it.isDirectory()) walk(full, rel);
      else if (it.isFile()) out.push({ path: rel, data: fs.readFileSync(full) });
    }
  };
  walk(dir, '');
  return out;
}

/** 用新的內容整個換掉資料夾（先寫到暫存資料夾，成功了才換，失敗不會弄壞舊的） */
export function replaceDir(dir: string, entries: TarEntry[]) {
  const tmp = `${dir}.new-${Date.now()}`;
  fs.mkdirSync(tmp, { recursive: true });
  for (const e of entries) {
    const dest = path.join(tmp, e.path);
    if (!dest.startsWith(tmp + path.sep)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.data);
  }
  const old = `${dir}.old-${Date.now()}`;
  if (fs.existsSync(dir)) fs.renameSync(dir, old);
  fs.renameSync(tmp, dir);
  fs.rmSync(old, { recursive: true, force: true });
}
