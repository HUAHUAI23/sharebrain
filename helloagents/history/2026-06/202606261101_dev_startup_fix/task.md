# 任务清单: 修复 turbo dev 启动问题

目录: `helloagents/history/2026-06/202606261101_dev_startup_fix/`

---

## 1. 启动脚本

- [√] 1.1 修正 API dev 脚本，避免 `bun --hot` 占用 3000。
- [√] 1.2 修正 Collab dev 脚本，使用 Node 运行 Hocuspocus。
- [√] 1.3 修正 Worker dev 脚本并保持常驻。
- [√] 1.4 固定 Web Vite 端口，禁止自动漂移。

## 2. 文档同步

- [√] 2.1 更新开发规范。
- [√] 2.2 更新 HelloAgents 模块文档。
- [√] 2.3 更新变更历史。

## 3. 验证

- [√] 3.1 执行类型检查。
- [√] 3.2 执行构建。
- [√] 3.3 执行 `turbo dev` 启动冒烟。
