# 任务清单: 开发体系初始化

目录: `helloagents/history/2026-06/202606261041_framework/`

---

## 1. Monorepo 基础

- [√] 1.1 创建根 `package.json`、`turbo.json`、`tsconfig.json`、`bunfig.toml`。
- [√] 1.2 建立共享 TypeScript 配置。

## 2. 共享包

- [√] 2.1 创建 `packages/config` 环境配置包。
- [√] 2.2 创建 `packages/contracts` 合约包。
- [√] 2.3 创建 `packages/db` 数据包。
- [√] 2.4 创建 `packages/i18n` 国际化包。
- [√] 2.5 创建 `packages/ui` UI 组件包。

## 3. 应用骨架

- [√] 3.1 创建 `apps/web` 工作台壳层。
- [√] 3.2 创建 `apps/api` Hono API 壳层。
- [√] 3.3 创建 `apps/collab` Hocuspocus 壳层。
- [√] 3.4 创建 `apps/worker` 后台任务壳层。

## 4. 文档和知识库

- [√] 4.1 创建架构、目录、开发、代码、UI、AI 规范。
- [√] 4.2 初始化 HelloAgents 知识库。
- [√] 4.3 归档本次方案包到 history。

## 5. 验证

- [√] 5.1 执行 `bun install`。
- [√] 5.2 执行 `bun run typecheck`。
- [√] 5.3 执行 `bun run lint:docs`。
