// 直接把 marked 的 token 渲染成 React 元素：不注入 HTML，也就没有 XSS 面。
import type { Token, Tokens } from "marked";
import { memo, useMemo, type ReactNode } from "react";

import { parseChatMarkdown } from "./knowledge-chat-markdown-blocks";

const ALIGN_CLASS = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
} as const;

function inlineNodes(tokens: Token[] | undefined): ReactNode {
  if (!tokens || tokens.length === 0) return null;
  return tokens.map((token, index) => (
    <InlineToken key={index} token={token} />
  ));
}

function InlineToken({ token }: { token: Token }): ReactNode {
  switch (token.type) {
    case "strong":
      return <strong className="font-semibold">{inlineNodes((token as Tokens.Strong).tokens)}</strong>;
    case "em":
      return <em className="italic">{inlineNodes((token as Tokens.Em).tokens)}</em>;
    case "del":
      return <del className="text-muted-foreground">{inlineNodes((token as Tokens.Del).tokens)}</del>;
    case "codespan":
      return (
        <code className="rounded-sm bg-muted px-1 py-px font-mono text-[12px]">
          {(token as Tokens.Codespan).text}
        </code>
      );
    case "link": {
      const link = token as Tokens.Link;
      return (
        <a
          className="text-foreground underline underline-offset-2 hover:text-muted-foreground"
          href={link.href}
          target="_blank"
          rel="noreferrer"
        >
          {inlineNodes(link.tokens) ?? link.href}
        </a>
      );
    }
    case "image": {
      const image = token as Tokens.Image;
      return (
        <img
          className="my-1 max-w-full rounded-sm border border-border"
          src={image.href}
          alt={image.text}
          loading="lazy"
          decoding="async"
        />
      );
    }
    case "br":
      return <br />;
    default:
      // text / escape / html 一律按纯文本渲染，绝不交给 innerHTML。
      return (token as Tokens.Text).tokens
        ? inlineNodes((token as Tokens.Text).tokens)
        : (token as Tokens.Text).text ?? token.raw;
  }
}

function BlockToken({ token }: { token: Token }): ReactNode {
  switch (token.type) {
    case "heading": {
      const heading = token as Tokens.Heading;
      const size = heading.depth <= 1
        ? "text-[15px]"
        : heading.depth === 2
          ? "text-[14px]"
          : "text-[13px]";
      return (
        <p className={`mt-1 font-semibold ${size}`}>{inlineNodes(heading.tokens)}</p>
      );
    }
    case "paragraph":
      return <p>{inlineNodes((token as Tokens.Paragraph).tokens)}</p>;
    case "code": {
      const code = token as Tokens.Code;
      return (
        <div className="overflow-hidden rounded-sm border border-border bg-muted">
          {code.lang ? (
            <div className="border-b border-border px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
              {code.lang}
            </div>
          ) : null}
          {/* 代码块自己横向滚动，绝不把面板顶出横向溢出。 */}
          <pre className="overflow-x-auto px-2.5 py-2">
            <code className="font-mono text-[12px] leading-5">{code.text}</code>
          </pre>
        </div>
      );
    }
    case "list": {
      const list = token as Tokens.List;
      const items = list.items.map((item, index) => (
        <li key={index} className={item.task ? "list-none" : undefined}>
          {item.task ? (
            <input
              className="mr-1.5 align-middle"
              type="checkbox"
              checked={item.checked ?? false}
              readOnly
              aria-hidden
            />
          ) : null}
          {inlineNodes(item.tokens)}
        </li>
      ));
      return list.ordered ? (
        <ol className="ml-5 grid list-decimal gap-1" start={Number(list.start) || 1}>{items}</ol>
      ) : (
        <ul className="ml-5 grid list-disc gap-1">{items}</ul>
      );
    }
    case "blockquote":
      return (
        <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
          {(token as Tokens.Blockquote).tokens.map((child, index) => (
            <BlockToken key={index} token={child} />
          ))}
        </blockquote>
      );
    case "table": {
      const table = token as Tokens.Table;
      return (
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-border bg-muted">
                {table.header.map((cell, index) => (
                  <th
                    key={index}
                    className={`px-2.5 py-1.5 font-semibold ${ALIGN_CLASS[table.align[index] ?? "left"]}`}
                  >
                    {inlineNodes(cell.tokens)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-border last:border-b-0">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={`px-2.5 py-1.5 ${ALIGN_CLASS[table.align[cellIndex] ?? "left"]}`}
                    >
                      {inlineNodes(cell.tokens)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "hr":
      return <hr className="border-border" />;
    default:
      return <p className="whitespace-pre-wrap">{token.raw}</p>;
  }
}

/**
 * 记忆化的边界。`raw` 相同就说明这个块在本次增量里没有变化，
 * 直接复用上一帧的 DOM，是流式渲染不随长度变慢的关键。
 */
const MarkdownBlock = memo(
  ({ token }: { token: Token }) => <BlockToken token={token} />,
  (previous, next) => previous.token.raw === next.token.raw,
);
MarkdownBlock.displayName = "MarkdownBlock";

export const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
  const tokens = useMemo(() => parseChatMarkdown(text), [text]);
  return (
    <div className="grid gap-2 text-[13px] leading-6 break-words">
      {tokens.map((token, index) => (
        <MarkdownBlock key={index} token={token} />
      ))}
    </div>
  );
});
