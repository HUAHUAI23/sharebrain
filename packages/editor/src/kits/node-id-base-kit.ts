// 为所有可编辑块提供可复用的稳定身份，供协作、评论定位和宿主读模型使用。
import { NodeIdPlugin } from 'platejs';

export const BaseNodeIdKit = [
  NodeIdPlugin.configure({
    options: {
      filterInline: true,
      filterText: true,
      initialValueIds: 'always',
    },
  }),
];
