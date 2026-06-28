# 技术设计: UI 与数据库开发体验调整

## 技术方案

### 核心技术

- lucide-react
- shadcn 风格组件
- PostgreSQL
- Drizzle ORM / drizzle-kit push
- postgres-js

### 实现要点

- `packages/ui/src/styles/globals.css` 调整 Notion 风格 token 和全局图标 stroke。
- `apps/web/src/app/app.tsx` 增加 workspace switcher、页面列表、页面工具栏。
- `packages/db/drizzle.config.ts` 增加 `schemaFilter`、`tablesFilter`、`strict`、`verbose`。
- `packages/db/src/database-url.ts` 处理 Postgres URL normalize 和 identifier quote。
- `packages/db/src/schema-tables.ts` 从 Drizzle schema 自动收集表名。
- `packages/db/src/scripts/reset.ts` 删除并重建开发数据库。

## 架构决策 ADR

### ADR-005: 开发阶段使用 Drizzle push

**上下文:** 当前处于早期开发阶段，数据表结构会频繁变化，migration 文件会产生大量噪音。
**决策:** 开发阶段只保留 `db:push`、`db:reset`、`db:reset:push`、`db:studio`。
**理由:** 降低 schema 快速迭代成本，避免无意义迁移历史。
**替代方案:** 从第一天开始生成 migration → 拒绝原因: 早期结构频繁变化，迁移文件维护成本高。
**影响:** 不能用于生产库演进；稳定阶段需重新引入 migration 流。

### ADR-006: Notion 风格图标和块级布局

**上下文:** UI 需要更贴近 Notion 的工作台气质，而非通用管理后台。
**决策:** 使用单色细线图标、浅灰 hover、弱边框、页面图标和块级列表。
**理由:** 更符合项目知识库和协作文档产品的使用预期。
**替代方案:** 保持 shadcn 默认视觉 → 拒绝原因: 风格辨识度不足。
**影响:** 组件视觉更克制，后续新组件需遵守 UI 规范。

## 安全与性能

- **安全:** `db:reset` 禁止 production；不处理真实生产库。
- **性能:** UI 仅样式和静态结构调整，无运行时性能风险。

## 测试与部署

- `bun run typecheck`
- `bun run lint:docs`
- `bun run build`
