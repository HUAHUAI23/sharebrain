// 为离线导出递归内联正文图片，避免静态导出文件依赖登录态媒体地址。
import { KEYS, type Descendant, type Value } from 'platejs';

import { blobToDataUrl } from './export-editor-media';

/**
 * 文档媒体通常是需要登录态的 API 地址，离线导出前需要尽量内联；
 * 离线或跨域获取失败时保留原地址，避免中断整个导出。
 */
export async function inlineEditorImageUrls(
  value: Descendant[]
): Promise<Value> {
  const inlineNode = async (node: Descendant): Promise<Descendant> => {
    if (!('type' in node)) return node;

    let next = node;

    if (
      node.type === KEYS.img &&
      typeof node.url === 'string' &&
      !node.url.startsWith('data:')
    ) {
      try {
        const response = await fetch(node.url, { credentials: 'include' });

        if (response.ok) {
          next = { ...node, url: await blobToDataUrl(await response.blob()) };
        }
      } catch {
        // 离线或跨域取不到时保留原地址。
      }
    }

    if ('children' in next && Array.isArray(next.children)) {
      return {
        ...next,
        children: await Promise.all(next.children.map(inlineNode)),
      } as Descendant;
    }

    return next;
  };

  return Promise.all(value.map(inlineNode)) as Promise<Value>;
}
