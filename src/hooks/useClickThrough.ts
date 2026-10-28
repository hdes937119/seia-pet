import { RefObject, useEffect } from 'react';

/**
 * 透明區域滑鼠穿透（只在 Electron 桌寵視窗有效）：
 * 滑鼠停在標記 data-passthrough 的透明背景上時，讓點擊直接穿過桌寵視窗，
 * 點到底下的遊戲或網頁；移到立繪、對話框、選單上時才恢復可點擊。
 * （Electron 會用 forward 模式繼續傳 mousemove 進來，所以能隨時切回來）
 */
export function useClickThrough(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.setIgnoreMouse) return;

    let ignoring = false;
    const update = (ignore: boolean) => {
      if (ignore === ignoring) return;
      ignoring = ignore;
      api.setIgnoreMouse(ignore);
    };

    const onMove = (e: MouseEvent) => {
      // 正在按住拖曳（例如拖角落把手）時不要切換
      if (e.buttons !== 0) return;
      const target = e.target as HTMLElement | null;
      update(Boolean(target && target.hasAttribute('data-passthrough')));
    };
    // 滑鼠離開視窗：保持可穿透，避免擋住桌面
    const onLeave = () => update(true);

    window.addEventListener('mousemove', onMove);
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      api.setIgnoreMouse(false);
    };
  }, [rootRef]);
}
