// 确保标题节点暴露 TOC 滚动观察所依赖的稳定 HTML 锚点。
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { HeadingElement } from './heading-node';

describe('HeadingElement', () => {
  test('renders the node id as the heading anchor used by the TOC observer', () => {
    const html = renderToStaticMarkup(
      <HeadingElement
        variant="h2"
        editor={{ api: { isBlock: () => true } } as never}
        element={{
          id: 'section-implementation',
          type: 'h2',
          children: [{ text: 'Implementation' }],
        }}
        attributes={{ 'data-slate-node': 'element', ref: () => {} }}
      >
        Implementation
      </HeadingElement>
    );

    expect(html).toContain('id="section-implementation"');
    expect(html).toContain('data-slate-node="element"');
  });
});
