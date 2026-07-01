# 代码规范

## TypeScript

- 全仓库使用 strict TypeScript。
- 对外边界必须显式导出类型。
- API 入参、AI tool input、数据库派生数据必须有 Zod schema。
- 禁止使用 `any` 绕过约束；确实需要时使用 `unknown` 后缩小类型。
- 捕获异常时按 `unknown` 处理，不假设 Error 类型。

## 命名

- 文件名使用 kebab-case: `document-indexing.ts`。
- React 组件使用 PascalCase。
- Hook 使用 `useXxx`。
- schema 使用 `xxxSchema`，类型使用 `Xxx`。
- 数据库字段在代码中使用 camelCase，数据库列使用 snake_case。

## 模块边界

- `apps/web` 不导入 `packages/db`。
- `apps/collab` 不实现业务 CRUD。
- `apps/worker` 不直接暴露 HTTP API。
- `packages/ui` 不依赖业务包。
- `packages/contracts` 不依赖 app 或 db。
- API route 只处理 HTTP 和 schema 解析，业务规则放 service，数据库查询封装在 service/repository 边界内。
- `apps/api/src/app/create-app.ts` 必须支持依赖注入，测试通过注入独立 db/env 运行，避免启动网络服务。
- 用户自定义字段的静态类型由字段配置 schema 表达，运行时 values 必须由 service 基于字段定义动态 Zod 校验。

## Tailwind className

- className 按布局、尺寸、视觉、状态的顺序组织；复杂组件继续使用 `cn()` 合并条件类。
- 优先使用 Tailwind 标准 utility 和项目 token，不用等价 arbitrary value。示例: `rounded-sm` 替代 `rounded-[4px]`，`top-px` 替代 `top-[1px]`，`space-y-px` 替代 `space-y-[1px]`。
- Tailwind v4 CSS 变量值使用括号简写，例如 `ring-(--ring-soft)`、`border-(--color-border)`、`bg-(--color-bg)`。
- 允许保留 shadcn/Radix 组件生成的 CSS 变量、`calc()`、transform origin、available height 等 arbitrary value；不要为了“消灭方括号”改坏组件定位。
- 业务 feature 中重复出现的 arbitrary value 应抽为 UI primitive、`@theme` token 或局部 CSS 类。
- 禁止负字距和 viewport 字号作为默认 UI 方案。

## 错误处理

- API 错误返回 `{ code, message, details? }`。
- 业务错误在 service 层归一化，route 层只映射 HTTP 状态。
- Worker 任务必须记录 job id、输入摘要、失败原因和重试策略。
- 媒体上传 complete 阶段只承诺校验 size 和 content-type；不要把 multipart ETag 当 MD5。

## 测试

- contract/schema 变更补 Bun 单测。
- API service 变更补 service 和 route 测试。
- Web 关键工作流补 Playwright 或组件级 smoke test。
- Collab 后续接入真实持久化时必须补权限和只读连接测试。
