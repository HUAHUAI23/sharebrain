// 把回答正文切成顶层 Markdown 块。纯函数，不依赖 React，便于单测。
import { marked, type Token } from "marked";

/**
 * 流式渲染的性能全靠这一步：每收一批增量只重新词法分析一次，
 * 得到的块用 `raw` 做记忆化键，已完成的块在后续帧里被 React 整体跳过。
 * 只有最后一个块是"活的"，重渲染成本与回答长度无关。
 */
export function parseChatMarkdown(text: string): Token[] {
  if (!text) return [];
  // 未闭合的围栏、强调在流式中途必然出现，marked 会按最合理的形态兜底，不抛错。
  return marked.lexer(text).filter((token) => token.type !== "space");
}
