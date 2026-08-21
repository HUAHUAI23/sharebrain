// 流式输出时的"贴底跟随"。
//
// 关键在于：跟不跟随必须由用户手势决定，不能从"当前距底多远"反推。
// 正文自己长高时（一帧塞进一个表格或代码块就是几百 px），提交后量出来的距离
// 天然很大，用它判断会误判成"用户在回看历史"，从此再不跟随——表现就是
// 界面看起来卡住，其实内容一直在视口外增长。
import { useCallback, useEffect, useRef, useState } from "react";

/** 回到这个距离内就重新贴底，给滚动条留一点容差。 */
const REATTACH_PX = 32;

export function useStickToBottom(getViewport: () => HTMLElement | null) {
  const following = useRef(true);
  const [detached, setDetached] = useState(false);

  const setFollowing = useCallback((next: boolean) => {
    if (following.current === next) return;
    following.current = next;
    setDetached(!next);
  }, []);

  useEffect(() => {
    const viewport = getViewport();
    if (!viewport) return;

    // 只有向上的主动手势才脱离跟随。
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) setFollowing(false);
    };
    const onTouchMove = () => setFollowing(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) setFollowing(false);
    };
    // 用户自己滚回底部就恢复跟随。
    const onScroll = () => {
      const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      if (distance <= REATTACH_PX) setFollowing(true);
    };

    viewport.addEventListener("wheel", onWheel, { passive: true });
    viewport.addEventListener("touchmove", onTouchMove, { passive: true });
    viewport.addEventListener("keydown", onKeyDown);
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("touchmove", onTouchMove);
      viewport.removeEventListener("keydown", onKeyDown);
      viewport.removeEventListener("scroll", onScroll);
    };
  }, [getViewport, setFollowing]);

  /** 内容增长后调用。直接写 scrollTop：平滑滚动会与逐帧增长互相打架。 */
  const stick = useCallback(() => {
    if (!following.current) return;
    const viewport = getViewport();
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [getViewport]);

  /** 用户点"回到底部"时用，强制重新贴底。 */
  const reattach = useCallback(() => {
    setFollowing(true);
    const viewport = getViewport();
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [getViewport, setFollowing]);

  return { stick, reattach, detached };
}
