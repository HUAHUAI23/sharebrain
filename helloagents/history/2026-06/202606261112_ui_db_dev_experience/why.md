# 变更提案: UI 与数据库开发体验调整

## 需求背景

当前 UI 风格仍偏通用 shadcn 工作台，尚未充分贴近 Notion 的低装饰、细线图标、块级列表和页面图标体验。同时开发阶段数据库表结构变化频繁，不适合生成 migration 文件，需要改为 PostgreSQL + Drizzle push/reset 的开发体验。

## 变更内容

1. 继续对齐 Notion 风格 UI token、图标和工作台布局。
2. 统一图标为 lucide-react 单色细线，默认 14-16px。
3. 补齐数据库 helper、表名过滤、reset 脚本和根级 DB 命令。
4. 移除开发阶段 `db:generate`、`db:migrate` 脚本。
5. 同步 docs 和 HelloAgents 知识库。

## 影响范围

- **模块:** web、ui、db、docs、helloagents。
- **文件:** UI token、Web 工作台、DB package、DB helper/reset、规范文档、知识库。
- **API:** 无业务 API 变更。
- **数据:** 无表结构语义变更，调整开发期数据库操作方式。

## 核心场景

### 需求: 开发期数据库直推

**模块:** db

开发者修改 `packages/db/src/schema.ts` 后，直接运行 `bun run db:push` 推送到 PostgreSQL。

#### 场景: 重建开发库

开发阶段需要清空结构时，执行 `bun run db:reset:push`。

- `db:reset` 禁止在 production 环境执行。
- 开发阶段不生成 migration 文件。

### 需求: Notion 风格继续对齐

**模块:** ui

工作台应呈现 Notion 式侧边栏、页面图标、单色细线图标、弱边框和浅灰 hover。

#### 场景: 打开工作台

- 左侧是 workspace switcher、搜索和块级页面列表。
- 页面面板弱边框、低圆角。
- 工具栏图标单色细线。

## 风险评估

- **风险:** `db:reset` 会删除开发数据库。
- **缓解:** 脚本禁止 production；命令名明确为 reset，文档说明只用于开发期。
