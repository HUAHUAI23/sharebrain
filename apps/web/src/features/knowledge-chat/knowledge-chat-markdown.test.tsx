import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatMarkdown } from "./knowledge-chat-markdown";

const render = (text: string) => renderToStaticMarkup(<ChatMarkdown text={text} />);

describe("ChatMarkdown", () => {
  test("渲染常见块级结构", () => {
    const html = render("# 标题\n\n段落 **粗**\n\n1. 一\n2. 二\n\n> 引用");
    expect(html).toContain("标题");
    expect(html).toContain("<strong");
    expect(html).toContain("<ol");
    expect(html).toContain("<blockquote");
  });

  test("代码块带语言标注并自己横向滚动", () => {
    const html = render("```ts\nconst a = 1;\n```");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("const a = 1;");
  });

  test("表格对齐不产生互相冲突的 Tailwind 类", () => {
    const html = render("| a | b |\n|:--|--:|\n| 1 | 2 |");
    const cellClasses = [...html.matchAll(/<t[hd] class="([^"]*)"/gu)].map((match) => match[1] ?? "");
    expect(cellClasses.length).toBeGreaterThan(0);
    for (const classes of cellClasses) {
      // 同一个元素上出现两个对齐类时，胜出的是样式表顺序而不是这里的写法顺序。
      const alignments = classes.split(" ")
        .filter((name) => ["text-left", "text-center", "text-right"].includes(name));
      expect(alignments).toHaveLength(1);
    }
    expect(cellClasses.some((classes) => classes.includes("text-right"))).toBe(true);
  });

  test("正文里的 HTML 只作为文本出现，不会变成真的标签", () => {
    const html = render('正文 <script>alert(1)</script> 与 <img src=x onerror=alert(1)>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  test("流式中途的未闭合内容不抛错", () => {
    expect(() => render("说明\n\n```ts\nconst a")).not.toThrow();
    expect(() => render("**未闭合")).not.toThrow();
    expect(() => render("| a | b")).not.toThrow();
  });
});
