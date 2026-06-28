# Changelog

本文件记录项目所有重要变更。
格式基于 Keep a Changelog，版本号遵循语义化版本。

## [Unreleased]

### 变更
- 进一步对齐 Notion 风格 UI token、图标规范和工作台布局。
- 调整数据库开发体验为 PostgreSQL + Drizzle push/reset/studio，不生成开发期 migration 文件。

### 修复
- 修正 `turbo dev` 启动脚本: Hocuspocus 协作服务改用 Node 运行时，API/Worker 取消 `bun --hot`，Web 固定 3000 端口。

## [0.1.0] - 2026-06-26

### 新增
- 初始化 ShareBrain Bun/Turbo monorepo 开发体系。
- 新增 `apps/web`、`apps/api`、`apps/collab`、`apps/worker` 四应用骨架。
- 新增 `packages/config`、`packages/contracts`、`packages/db`、`packages/i18n`、`packages/ui`、`packages/typescript-config` 共享包。
- 新增项目架构、目录、开发、代码、UI、AI 开发规范文档。
- 初始化 HelloAgents 知识库，供后续 AI 按规范开发。
