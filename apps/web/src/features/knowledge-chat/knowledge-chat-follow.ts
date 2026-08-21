// 流式输出时的"贴底跟随"，按 ChatGPT / Claude 一类界面的通行做法实现。
//
// 两条原则决定了整个实现：
//
// 1. **跟随由 ResizeObserver 驱动，不由 React 渲染驱动。** 内容的真实高度变化
//    发生在浏览器完成布局之后——字体加载、图片解码、Markdown 重排都会改高度，
//    而这些都不对应一次 React 渲染。挂在 state 上必然漏掉，表现就是滚动跟不上。
//
// 2. **跟不跟随是用户手势决定的状态，不能从"当前距底多远"反推。** 正文自己长高时
//    （一帧塞进一个表格或代码块就是几百 px），量出来的距离天然很大，用它判断会
//    误判成"用户在回看历史"，从此再不跟随——界面看起来卡死，其实内容在视口外增长。
import { useCallback, useEffect, useRef, useState } from "react";

/** 回到这个距离内就重新贴底，给滚动条和亚像素留容差。 */
const REATTACH_PX = 40;

type Options = {
  getViewport: () => HTMLElement | null;
  getContent: () => HTMLElement | null;
};

export function useStickToBottom({ getViewport, getContent }: Options) {
  const following = useRef(true);
  const programmatic = useRef(false);
  const [detached, setDetached] = useState(false);

  const setFollowing = useCallback((next: boolean) => {
    following.current = next;
    setDetached((current) => (current === !next ? current : !next));
  }, []);

  /** 直接写 scrollTop：平滑滚动会与逐帧增长互相打架。 */
  const scrollToBottom = useCallback(() => {
    const viewport = getViewport();
    if (!viewport) return;
    // 打上标记，好让紧随其后的 scroll 事件不被当成用户手势。
    programmatic.current = true;
    viewport.scrollTop = viewport.scrollHeight;
  }, [getViewport]);

  useEffect(() => {
    const viewport = getViewport();
    const content = getContent();
    if (!viewport || !content) return;

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) setFollowing(false);
    };
    const onTouchMove = () => setFollowing(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) setFollowing(false);
    };
    const onScroll = () => {
      // 自己写进去的滚动不算用户手势。
      if (programmatic.current) {
        programmatic.current = false;
        return;
      }
      const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      setFollowing(distance <= REATTACH_PX);
    };

    // 内容一变高就跟到底，与 React 的渲染时机无关。
    const observer = new ResizeObserver(() => {
      if (following.current) scrollToBottom();
    });
    observer.observe(content);

    viewport.addEventListener("wheel", onWheel, { passive: true });
    viewport.addEventListener("touchmove", onTouchMove, { passive: true });
    viewport.addEventListener("keydown", onKeyDown);
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("touchmove", onTouchMove);
      viewport.removeEventListener("keydown", onKeyDown);
      viewport.removeEventListener("scroll", onScroll);
    };
  }, [getContent, getViewport, scrollToBottom, setFollowing]);

  /** 用户点"回到最新"时用，强制重新贴底。 */
  const reattach = useCallback(() => {
    setFollowing(true);
    scrollToBottom();
  }, [scrollToBottom, setFollowing]);

  return { reattach, detached };
}
