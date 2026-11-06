import { useEffect, useRef } from 'react';

/**
 * 常駐連線到後端的 Server-Sent Events 推播通道（/api/events）。
 * 後端可以隨時主動推送事件（例如自主探索完成的 discovery），斷線時瀏覽器會自動重連。
 */
export function useServerEvents(handlers: Record<string, (data: any) => void>) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const source = new EventSource('/api/events');
    const names = ['hello', 'discovery', 'explore-status', 'keywords', 'line-history', 'meal', 'gemini-web', 'pet-says', 'busy'];
    const listeners = names.map((name) => {
      const listener = (e: MessageEvent) => {
        try {
          handlersRef.current[name]?.(JSON.parse(e.data));
        } catch (err) {
          console.warn(`[推播] ${name} 事件解析失敗`, err);
        }
      };
      source.addEventListener(name, listener as EventListener);
      return [name, listener] as const;
    });
    return () => {
      listeners.forEach(([name, l]) => source.removeEventListener(name, l as EventListener));
      source.close();
    };
  }, []);
}
