# db

## 目的

集中维护 PostgreSQL/Drizzle 数据 schema 和数据库 client。

## 模块概述

- **职责:** 数据表、relations、Drizzle push 配置、数据库 client、开发期 reset 脚本。
- **状态:** 🚧开发中
- **最后更新:** 2026-06-26

## 规范

### 需求: 数据层框架搭建

**模块:** db

建立 `packages/db`，定义项目、文档、协作、搜索、时间线、AI chunk 和审计核心表。

#### 场景: 开发期推送 schema

- 开发者修改 `packages/db/src/schema.ts`。
- 执行 `bun run db:push` 推送到 PostgreSQL。
- 如需重建开发库，执行 `bun run db:reset:push`。
- 开发阶段不生成 migration 文件。

## 依赖

- Drizzle ORM
- drizzle-kit
- postgres
- `@sharebrain/config`

## 变更历史

- [202606261041_framework](../history/2026-06/202606261041_framework/) - 初始化数据层骨架。
