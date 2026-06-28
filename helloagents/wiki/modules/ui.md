# ui

## 目的

提供 shadcn 风格基础 UI 组件和 Notion 风格设计 token。

## 模块概述

- **职责:** Button、Input、Surface、全局样式、组件库配置。
- **状态:** 🚧开发中
- **最后更新:** 2026-06-26

## 规范

### 需求: UI 库建立

**模块:** ui

建立 `packages/ui`，组件采用 shadcn 复制式组件形态，样式参考 Notion 的中性、内容优先、低装饰设计。

#### 场景: 前端复用基础组件

- Web 通过 `@sharebrain/ui/components/*` 使用基础组件。
- UI 包不依赖业务包。
- 图标按钮必须使用 lucide-react 并提供 `aria-label`。
- 图标默认 14-16px、单色细线、`stroke-width: 1.75`，避免彩色填充图标。

## 依赖

- React
- class-variance-authority
- clsx
- tailwind-merge
- lucide-react

## 变更历史

- [202606261041_framework](../history/2026-06/202606261041_framework/) - 初始化 UI 库骨架。
