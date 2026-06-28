# 变更提案: 开发体系初始化

## 需求背景

项目需要基于“私有化共享大脑项目”背景文档搭建开发框架。本阶段重点是把技术路线、目录结构、应用骨架、UI 库和开发规范落实，业务功能暂不实现。

## 产品分析

### 目标用户与场景

- **用户群体:** 私有化交付、运维、项目管理和后续 AI 开发协作者。
- **使用场景:** 后续开发者和 AI 基于统一知识库继续实现项目、文档、协作、搜索、时间线和 AI 能力。
- **核心痛点:** 缺少统一工程结构和规范时，后续多模块开发容易出现边界混乱、重复定义和文档脱节。

### 价值主张与成功指标

- **价值主张:** 先建立可运行、可扩展、可追溯的开发体系。
- **成功指标:** Bun workspace 可安装，四应用和共享包存在，规范文档和 HelloAgents 知识库完整。

### 人文关怀

平台面向私有化项目知识，默认强调权限、审计、证据追溯和 AI 不越权访问。

## 变更内容

1. 建立 Bun/Turbo monorepo。
2. 建立 `apps/web`、`apps/api`、`apps/collab`、`apps/worker`。
3. 建立 `packages/config`、`contracts`、`db`、`i18n`、`ui`、`typescript-config`。
4. 建立项目规范、代码规范、UI 规范、AI 开发规范。
5. 初始化 HelloAgents 知识库。

## 影响范围

- **模块:** web、api、collab、worker、db、ui、contracts、config、i18n。
- **文件:** 根配置、apps、packages、docs、helloagents。
- **API:** 新增 health 接口。
- **数据:** 新增核心数据表 schema。

## 核心场景

### 需求: 搭建开发体系

**模块:** framework

开发者可以安装依赖、运行类型检查，并按文档继续开发业务模块。

#### 场景: 后续 AI 规范开发

知识库提供架构、目录、API、数据、模块和规范文档。

- AI 可以先读取 `helloagents/project.md` 和 `helloagents/wiki/*`。
- 代码改动后同步更新 docs 和 wiki。
- 新依赖默认使用 latest 并记录到 root catalog。

## 风险评估

- **风险:** 依赖 latest 可能存在兼容性变化。
- **缓解:** 使用 `bun run typecheck` 和安装验证；遇到兼容问题记录原因后收敛版本。
