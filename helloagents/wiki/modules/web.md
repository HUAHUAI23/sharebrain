# web

## 目的

提供 React + Plate 项目知识工作台。

## 模块概述

- **职责:** 工作台布局、文档编辑器挂载、搜索入口、时间线入口、AI 交互入口。
- **状态:** 🚧开发中
- **最后更新:** 2026-06-26

## 规范

### 需求: 开发框架搭建

**模块:** web

建立 `apps/web`，使用 React、Vite、TanStack Query、Zustand、Plate 依赖边界和 `packages/ui` 组件。

#### 场景: 打开工作台

用户访问前端应用时，应看到实际工作台结构，而不是营销页。

- 左侧提供项目、搜索、时间线入口。
- 主区域提供项目上下文面板和编辑器挂载区域。
- 当前阶段明确不实现业务 CRUD。

## 依赖

- `@sharebrain/ui`
- `@sharebrain/i18n`
- `@sharebrain/contracts`
- TanStack Query
- Zustand
- Plate

## 变更历史

- [202606261041_framework](../history/2026-06/202606261041_framework/) - 初始化 Web 骨架。
