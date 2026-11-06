/**
 * Windows 程式輸出的文字解碼（11/7）。
 *
 * 問題：wsl.exe 自己的訊息（例如「沒有安裝發行版」）預設是 UTF-16LE；winget 等 Windows 程式在繁體中文系統上
 * 可能用 Big5（cp950）；Linux 裡的程式則是 UTF-8。以前一律當 UTF-8 讀，wsl.exe 的錯誤就變成亂碼，
 * 西雅看不懂原因（11/7 她把「這台還沒裝工坊」誤判成「工坊壞了」）。
 *
 * 做法：呼叫 wsl.exe 時加 WSL_UTF8=1（新版 WSL 會改用 UTF-8），再用這裡的 decodeOutput() 猜編碼當保險。
 */

/** 給 spawn 用的環境變數：wsl.exe 用 UTF-8 輸出 */
export const wslEnv = () => ({ ...process.env, WSL_UTF8: '1' });

/** 收集子程序輸出的 Buffer，最後一次解碼（避免多位元組字被切半） */
export function collector(max = 4 * 1024 * 1024) {
  const chunks: Buffer[] = [];
  let size = 0;
  return {
    push(d: Buffer) {
      chunks.push(d);
      size += d.length;
      while (size > max && chunks.length > 1) size -= chunks.shift()!.length;
    },
    text: () => decodeOutput(Buffer.concat(chunks)),
  };
}

/** 猜編碼：UTF-16LE（很多 0x00）→ UTF-8（合法就用）→ Big5（繁中 Windows 的傳統編碼） */
export function decodeOutput(buf: Buffer): string {
  if (!buf || !buf.length) return '';
  // UTF-16LE：BOM，或奇數位置大量 0x00（ASCII 字元的高位元組）
  if ((buf[0] === 0xff && buf[1] === 0xfe) || looksUtf16le(buf)) {
    return buf.toString('utf16le').replace(/^﻿/, '').replace(/\u0000/g, '');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // 不是合法的 UTF-8
  }
  try {
    return new TextDecoder('big5').decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

function looksUtf16le(buf: Buffer): boolean {
  const n = Math.min(buf.length, 400);
  if (n < 4) return false;
  let zerosOdd = 0;
  let zerosEven = 0;
  for (let i = 0; i < n; i++) {
    if (buf[i] !== 0) continue;
    if (i % 2) zerosOdd++;
    else zerosEven++;
  }
  return zerosOdd > n / 6 && zerosEven < zerosOdd / 4;
}

/** 工坊（WSL 裡的 seia-workshop）不存在、WSL 沒裝的錯誤訊息 */
export function isWorkshopMissing(text: string): boolean {
  // 以前存下來的亂碼（UTF-16 被當 UTF-8 讀）裡英文字之間夾著 \u0000：先拿掉再比
  return /wsl(\.exe)?\s+--install|aka\.ms\/wslinstall|沒有(已)?安裝.*(發行|Linux)|未安裝.*(Linux|子系統)|no installed distributions|has no installed distributions|WSL_E_DISTRO_NOT_FOUND|There is no distribution with the supplied name|找不到.*(發行版|散發套件)|Windows Subsystem for Linux (is not|has not been) (installed|enabled)/i.test(
    String(text || '').replace(/\u0000/g, '')
  );
}
