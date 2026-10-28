import React from 'react';

/**
 * 視窗四個角落的拖曳把手：按住任一角落就能拖動整個桌寵視窗。
 * 按下時通知 Electron 主程式，由主程式跟著游標移動視窗（見 main.js 的 window-drag-start）。
 * 只在桌寵（Electron）視窗裡顯示。把手往內縮幾 px，保留視窗最外緣給系統的「拉角縮放」。
 */

const CORNERS = [
  { pos: 'top-1.5 left-1.5', lines: 'border-t-2 border-l-2 rounded-tl-lg' },
  { pos: 'top-1.5 right-1.5', lines: 'border-t-2 border-r-2 rounded-tr-lg' },
  { pos: 'bottom-1.5 left-1.5', lines: 'border-b-2 border-l-2 rounded-bl-lg' },
  { pos: 'bottom-1.5 right-1.5', lines: 'border-b-2 border-r-2 rounded-br-lg' },
];

export const WindowDragCorners: React.FC = () => {
  const api = typeof window !== 'undefined' ? (window as any).electronAPI : null;
  if (!api?.startWindowDrag) return null;

  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // 捕捉指標：游標拖出視窗外也能收到放開事件
    e.currentTarget.setPointerCapture(e.pointerId);
    api.startWindowDrag();
  };
  const stop = () => api.stopWindowDrag();

  return (
    <>
      {CORNERS.map(({ pos, lines }) => (
        <div
          key={pos}
          onPointerDown={start}
          onPointerUp={stop}
          onPointerCancel={stop}
          onLostPointerCapture={stop}
          className={`no-drag group fixed ${pos} z-[60] w-8 h-8 p-1.5 cursor-move select-none`}
          title="按住這裡拖動桌寵"
        >
          <div
            className={`w-full h-full ${lines} border-purple-300/50 group-hover:border-purple-200 group-active:border-pink-300 transition-colors pointer-events-none`}
          />
        </div>
      ))}
    </>
  );
};
