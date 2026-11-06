/**
 * 記錄主人「最後一次理她」的時間：點她、摸頭、右鍵選單、在對話框打字或捲動、送出訊息、語音輸入。
 *
 * 桌寵視窗的透明區域會讓滑鼠穿透（useClickThrough），所以只有真的點在她身上或她的面板上，
 * pointerdown 才會進到這個視窗；主人在玩遊戲、看網頁時的操作不會算進來。
 */

let lastInteractionAt = Date.now();
let installed = false;

export function markPetInteraction() {
  lastInteractionAt = Date.now();
}

/** 最後一次理她的時間（毫秒時間戳） */
export function lastPetInteractionAt(): number {
  return lastInteractionAt;
}

/** 開始監聽視窗裡的點擊、打字、捲動（只需要裝一次） */
export function installPetInteractionTracking() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  for (const e of ['pointerdown', 'keydown', 'wheel'] as const) {
    window.addEventListener(e, markPetInteraction, { passive: true, capture: true });
  }
}
