核心设计原则

  聊天系统按这几个原则设计：

  - REST 是权威数据通道：创建线程、发送消息、分页历史、重试、trace 查询。
  - WS/SSE 是实时事件通道：只推送 created、updated、delta、run step，不承担最终一致性。
  - 消息不要只存纯文本，要设计为 message + parts，支持文本、图片、文件、错误、文档、计划、操作结果。
  - 附件先上传成媒体对象，再在消息 part 中引用 mediaObjectId。
  - AI 回复不要阻塞请求，使用 durable assistant_run，支持 queued、running、failed、retry、recovery。
  - 前端用缓存驱动 UI：REST 拉历史，WS 增量更新缓存，断线后重新拉取恢复。

  后端方案

  后端建议拆成这些模块：

  ChatRoutes
  - thread CRUD
  - message list/create/retry
  - websocket events
  - trace/debug

  ChatService
  - 创建消息
  - 创建 assistant 占位消息
  - 调度 assistant run
  - 发布事件
  - 错误分类与重试

  ChatRepository
  - 事务写入 thread/message/parts/run
  - 分页读取历史
  - claim queued run
  - 记录 run step

  AgentResponder
  - 根据 chainKey 分发 AI 能力
  - 普通问答、写作、计划生成、资产处理等都走统一入口

  MediaService
  - 上传附件
  - 生成私有访问 URL
  - 读取附件供模型使用

  当前系统参考代码：

  - API 路由挂载：apps/api/src/app/api-router.ts:107
  - Chat REST/WS 路由：apps/api/src/modules/chat/chat.routes.ts:95
  - 消息创建与 AI run 调度：apps/api/src/modules/chat/chat.service.ts:186
  - Assistant run drain/stream：apps/api/src/modules/chat/chat.service.ts:352
  - 事务写消息与 assistant run：apps/api/src/modules/chat/chat.drizzle-repository.ts:162
  - WS 事件总线：apps/api/src/modules/chat/chat-event-bus.ts:15
  - AI 分发器：apps/api/src/modules/agent/agent-responder.ts:18
  - 统一 LLM stream/trace：apps/api/src/modules/agent/core/runtime/llm-stream.ts:52

  数据存储方案

  建议表结构：

  chat_threads
  chat_messages
  chat_message_parts
  chat_message_attachments
  chat_assistant_runs
  chat_run_steps
  media_objects
  agent_llm_calls

  当前系统参考代码：

  - 聊天表结构：apps/api/src/db/schema.ts:1079
  - 媒体对象表：apps/api/src/db/schema.ts:596
  - assistant run 表：apps/api/src/db/schema.ts:1161
  - run step 表：apps/api/src/db/schema.ts:1206
  - LLM trace 表：apps/api/src/db/schema.ts:1299
  - Chat contract/part 类型：packages/contracts/src/modules/chat/chat.schemas.ts:30
  - WS event contract：packages/contracts/src/modules/chat/chat.schemas.ts:217

  媒体附件方案

  附件处理建议：

  1. 前端选择文件
  2. 立即上传 Media API
  3. 成功后拿到 mediaObjectId
  4. 发送消息时只提交 ready 附件
  5. 后端校验 mediaObject.status=ready
  6. 后端校验 purpose=chat_attachment
  7. 展示时走后端 content URL，不直接暴露对象存储 URL
  8. 模型读取附件时单独限流/限大小

  当前系统参考代码：

  - 前端上传调用：apps/web/src/features/workflow-canvas/api/media-mutations.ts:10
  - composer 附件上传状态：apps/web/src/features/workflow-canvas/agent-chat/components/use-agent-chat-
  composer.ts:53
  - 附件限制与 draft 转 part：apps/web/src/features/workflow-canvas/agent-chat/domain/chat-attachments.ts:6
  - 后端媒体上传接口：apps/api/src/modules/media/media.routes.ts:75
  - 私有媒体访问接口：apps/api/src/modules/media/media.routes.ts:174
  - 后端附件校验：apps/api/src/modules/chat/chat.service.ts:687
  - 模型读取附件限制：apps/api/src/modules/chat/chat-attachment-reader.ts:6

  前端方案

  前端建议分层：

  api/
  - chat-client
  - chat-ws
  - use-chat-events
  - query-keys

  domain/
  - message-cache
  - attachment helpers
  - error mapping
  - output policy

  components/
  - ChatPanel
  - MessageList
  - MessageBubble
  - MessagePartRenderer
  - Composer
  - AttachmentChip
  - RunTimeline

  当前系统参考代码：

  - Canvas 页面集成聊天面板：apps/web/src/features/workflow-canvas/components/WorkflowCanvasPage.tsx:87
  - Chat REST client：apps/web/src/features/workflow-canvas/agent-chat/api/chat-client.ts:22
  - WS URL/clientId：apps/web/src/features/workflow-canvas/agent-chat/api/chat-ws.ts:3
  - WS 事件消费与缓存更新：apps/web/src/features/workflow-canvas/agent-chat/api/use-agent-chat-events.ts:17
  - thread 管理：apps/web/src/features/workflow-canvas/agent-chat/api/use-agent-chat-thread.ts:24
  - 消息面板与分页：apps/web/src/features/workflow-canvas/agent-chat/components/AgentMessageCard.tsx:28
  - 消息 part 渲染：apps/web/src/features/workflow-canvas/agent-chat/components/AgentMessageBubble.tsx:146
  - composer 发送逻辑：apps/web/src/features/workflow-canvas/agent-chat/components/use-agent-chat-composer.ts:147
  - run timeline store：apps/web/src/features/workflow-canvas/agent-chat/plan/run-timeline-store.ts:73

  落地顺序

  建议另一个系统按这个顺序做：

  1. 先实现 thread/message/parts 存储和 REST 历史分页。
  2. 再实现前端消息列表、composer、message part renderer。
  3. 再加 WS 事件通道，只做实时增量。
  4. 再加 assistant 占位消息、streaming delta。
  5. 再加 durable assistant run、retry、run step。
  6. 再加 media object 附件上传、预览、权限控制。
  7. 最后扩展 plan/document/action_result 这类业务型 AI 输出。