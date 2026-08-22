// 面板宽度：拖拽调整并记住。宽度是使用习惯，不该每次打开都回到默认值。
import { useCallback, useEffect, useRef, useState } from "react";

export const CHAT_PANEL_MIN_WIDTH = 380;
export const CHAT_PANEL_DEFAULT_WIDTH = 560;
const STORAGE_KEY = "sharebrain.chat.width";

/** 上限跟随视口，避免换到小屏后面板宽过头。 */
export function clampChatWidth(width: number, viewportWidth: number): number {
  const max = Math.max(CHAT_PANEL_MIN_WIDTH, Math.min(880, viewportWidth - 24));
  return Math.round(Math.min(max, Math.max(CHAT_PANEL_MIN_WIDTH, width)));
}

function readStoredWidth(): number {
  if (typeof window === "undefined") return CHAT_PANEL_DEFAULT_WIDTH;
  const stored = Number(window.localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(stored) && stored > 0 ? stored : CHAT_PANEL_DEFAULT_WIDTH;
}

export function useChatPanelWidth() {
  const [width, setWidth] = useState(CHAT_PANEL_DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    setWidth(clampChatWidth(readStoredWidth(), window.innerWidth));
  }, []);

  useEffect(() => {
    const onResize = () => setWidth((current) => clampChatWidth(current, window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const startResize = useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    setResizing(true);

    // 拖拽期间按帧提交宽度，指针事件的频率远高于刷新率。
    const onMove = (move: PointerEvent) => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setWidth(clampChatWidth(window.innerWidth - move.clientX - 12, window.innerWidth));
      });
    };
    const onUp = () => {
      handle.releasePointerCapture(event.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      setResizing(false);
      setWidth((current) => {
        window.localStorage.setItem(STORAGE_KEY, String(current));
        return current;
      });
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }, []);

  return { width, resizing, startResize };
}
