// 聊天送出時「當場」從螢幕共享抓一張畫面（不呼叫 Gemini，只是截圖）
// ScreenVisionTracker 在共享＋自動觀察開著時登記抓圖函式；App 送訊息時呼叫 grabLiveFrame()
type FrameGetter = () => string | null;
let getter: FrameGetter | null = null;

export function setLiveFrameGetter(g: FrameGetter | null) {
  getter = g;
}

export function grabLiveFrame(): { data: string; at: number } | null {
  try {
    const data = getter ? getter() : null;
    return data ? { data, at: Date.now() } : null;
  } catch {
    return null;
  }
}
