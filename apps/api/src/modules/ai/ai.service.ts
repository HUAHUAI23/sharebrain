import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ServerEnv } from "@sharebrain/config";
import type { AuthContext } from "@sharebrain/contracts";
import { auditLogs, type DatabaseClient } from "@sharebrain/db";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
} from "ai";

import { ApiError } from "../../app/api-error";
import { markdownJoinerTransform } from "./markdown-joiner-transform";

type AiCommandInput = {
  prompt: string;
  toolName: "generate" | "edit" | "comment";
};

export class AiService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly env: ServerEnv,
  ) {}

  async streamCommand(auth: AuthContext, input: AiCommandInput) {
    if (!this.env.AI_BASE_URL || !this.env.AI_API_KEY) {
      throw new ApiError("AI_NOT_CONFIGURED", "AI 服务未配置。", 422);
    }

    // 基座阶段只支持 generate 命令流；edit/comment 待协作审阅体系接入后开放。
    if (input.toolName !== "generate") {
      throw new ApiError("AI_TOOL_NOT_SUPPORTED", "当前仅支持 generate 命令。", 422);
    }

    const provider = createOpenAICompatible({
      name: this.env.AI_MODEL_PROVIDER,
      apiKey: this.env.AI_API_KEY,
      baseURL: this.env.AI_BASE_URL,
    });

    await this.db.insert(auditLogs).values({
      tenantId: auth.tenantId,
      actorId: auth.userId,
      action: "ai.command",
      resourceType: "ai_command",
      metadata: {
        requestId: auth.requestId,
        toolName: input.toolName,
        model: this.env.AI_MODEL,
        promptChars: input.prompt.length,
        maxOutputTokens: this.env.AI_MAX_OUTPUT_TOKENS,
      },
      createdBy: auth.userId,
      updatedBy: auth.userId,
    });

    const maxOutputTokens = this.env.AI_MAX_OUTPUT_TOKENS;
    const model = provider(this.env.AI_MODEL);
    const prompt = input.prompt;
    const toolName = input.toolName;

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({
          data: toolName,
          type: "data-toolName",
        });

        const result = streamText({
          experimental_transform: markdownJoinerTransform(),
          maxOutputTokens,
          model,
          prompt,
        });

        writer.merge(result.toUIMessageStream({ sendFinish: false }));
      },
    });

    return createUIMessageStreamResponse({ stream });
  }
}
