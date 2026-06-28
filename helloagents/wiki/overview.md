# ShareBrain

> 本文件包含项目级核心信息。详细模块文档见 `modules/` 目录。

## 1. 项目概述

### 目标与背景

ShareBrain 是面向私有化交付、运维和项目团队的项目周期上下文管理平台，目标是把项目历史文档、时间线、协作编辑、搜索、AI 总结问答和审计追溯组织成可私有化部署的工作台。

### 范围

- **范围内:** 开发框架、应用骨架、目录规范、项目规范、代码规范、UI 规范、AI 开发规范、知识库。
- **范围外:** 本阶段不实现项目 CRUD、文档 CRUD、真实权限、真实搜索、真实 AI 问答。

### 干系人

- **负责人:** 项目开发团队。

## 2. 模块索引

| 模块名称 | 职责 | 状态 | 文档 |
|---------|------|------|------|
| web | React + Plate 工作台 | 🚧开发中 | [web](modules/web.md) |
| api | Hono 主业务 API | 🚧开发中 | [api](modules/api.md) |
| collab | Hocuspocus 协作服务 | 🚧开发中 | [collab](modules/collab.md) |
| worker | 后台任务和 AI workflow | 🚧开发中 | [worker](modules/worker.md) |
| db | PostgreSQL/Drizzle 数据模型 | 🚧开发中 | [db](modules/db.md) |
| ui | shadcn 风格 UI 库 | 🚧开发中 | [ui](modules/ui.md) |

## 3. 快速链接

- [技术约定](../project.md)
- [架构设计](arch.md)
- [API 手册](api.md)
- [数据模型](data.md)
- [变更历史](../history/index.md)
- [目录规范](../../docs/project-structure.md)
- [开发规范](../../docs/standards/development.md)
- [UI 设计规范](../../docs/standards/ui-design.md)
- [AI 开发规范](../../docs/standards/ai-development.md)
