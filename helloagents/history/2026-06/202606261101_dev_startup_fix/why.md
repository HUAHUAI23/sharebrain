# 变更提案: 修复 turbo dev 启动问题

## 需求背景

执行 `turbo dev` 时暴露两个开发框架问题:

1. `apps/collab` 使用 Bun runtime 启动 Hocuspocus 4 时抛出 `[crossws] Using Node.js adapter in an incompatible environment.`。
2. `apps/api` 使用 `bun --hot` 时额外占用/打印默认开发服务器端口 3000，导致 Web Vite 端口漂移到 3002。

## 变更内容

1. Collab dev 改用 Node 运行时。
2. API/Worker dev 取消 `bun --hot`。
3. Worker dev 保持进程运行。
4. Web Vite 配置 `strictPort: true`。
5. 同步开发规范和知识库。

## 影响范围

- **模块:** api、collab、web、worker、docs、helloagents。
- **文件:** package scripts、Vite config、worker 入口、规范文档、知识库。
- **API:** 无业务 API 变更。
- **数据:** 无数据模型变更。

## 核心场景

### 需求: turbo dev 可稳定启动

**模块:** framework

开发者运行 `bun run dev` 或 `turbo dev` 时，四个 app 使用固定端口和正确运行时启动。

#### 场景: 本地开发启动

- Web 使用 3000。
- API 使用 3001。
- Collab 使用 3002。
- Worker 保持运行。

## 风险评估

- **风险:** Collab 与其他 Bun 服务运行时不一致。
- **缓解:** Hocuspocus 4 官方包声明 Node >=22，当前环境 Node 24 可满足；文档记录该运行时约束。
