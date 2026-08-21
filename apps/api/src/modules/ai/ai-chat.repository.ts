// 封装多轮会话、消息 parts、引用、run/step、反馈与 trace 的事务性持久化。
import {
  AI_RUN_STEP_KINDS,
  type AiCitation,
  type AiFeedback,
  type AiMessagePart,
  type AiRunStep,
  type AuthContext,
  type KnowledgeScope,
} from "@sharebrain/contracts";
import { upsertMediaUsageWithClient, type DatabaseClient } from "@sharebrain/db";
import {
  aiAssistantRuns,
  aiConversations,
  aiFeedbackEvents,
  aiMessageCitations,
  aiMessageParts,
  aiMessages,
  aiRetrievalTraces,
  aiRunSteps,
  knowledgeSourceScores,
  mediaUsages,
  tenantMemberships,
  users,
} from "@sharebrain/db/schema";
import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { ApiError } from "../../app/api-error";

const MODEL_HISTORY_MESSAGE_LIMIT = 12;

export class AiChatRepository {
  constructor(private readonly db: DatabaseClient) {}

  async createTurn(
    auth: AuthContext,
    input: {
      conversationId?: string;
      message: string;
      scope: KnowledgeScope;
      includeCrossProject: boolean;
      maxAttempts: number;
      attachments: Array<{
        id: string;
        fileName: string;
        mimeType: string;
        byteSize: number;
      }>;
    },
  ) {
    return this.db.transaction(async (tx) => {
      let conversation: typeof aiConversations.$inferSelect | undefined;
      if (input.conversationId) {
        [conversation] = await tx
          .select()
          .from(aiConversations)
          .where(and(
            eq(aiConversations.id, input.conversationId),
            eq(aiConversations.tenantId, auth.tenantId),
            eq(aiConversations.userId, auth.userId),
            isNull(aiConversations.deletedAt),
          ))
          .limit(1)
          .for("update");
        if (!conversation) {
          throw new ApiError("CONVERSATION_NOT_FOUND", "会话不存在。", 404);
        }
      } else {
        [conversation] = await tx
          .insert(aiConversations)
          .values({
            tenantId: auth.tenantId,
            userId: auth.userId,
            title: input.message.trim().replace(/\s+/g, " ").slice(0, 48),
            createdBy: auth.userId,
            updatedBy: auth.userId,
          })
          .returning();
      }
      if (!conversation) throw new Error("Failed to create conversation");

      const userSequence = conversation.lastSequence + 1;
      const assistantSequence = userSequence + 1;
      const [userMessage] = await tx.insert(aiMessages).values({
        tenantId: auth.tenantId,
        conversationId: conversation.id,
        sequence: userSequence,
        role: "user",
        activeProjectId: input.scope.activeProjectId,
        scopeResolution: input.scope.resolution,
        status: "complete",
        createdBy: auth.userId,
        updatedBy: auth.userId,
      }).returning();
      const [assistantMessage] = await tx.insert(aiMessages).values({
        tenantId: auth.tenantId,
        conversationId: conversation.id,
        sequence: assistantSequence,
        role: "assistant",
        activeProjectId: input.scope.activeProjectId,
        scopeResolution: input.scope.resolution,
        status: "streaming",
        createdBy: auth.userId,
        updatedBy: auth.userId,
      }).returning();
      if (!userMessage || !assistantMessage) throw new Error("Failed to create chat messages");
      const userParts: AiMessagePart[] = [
        { type: "text", text: input.message },
        ...input.attachments.map((attachment): AiMessagePart => ({
          type: "attachment",
          mediaObjectId: attachment.id,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          byteSize: attachment.byteSize,
        })),
      ];
      await tx.insert(aiMessageParts).values(userParts.map((part, partIndex) => ({
        tenantId: auth.tenantId,
        messageId: userMessage.id,
        partIndex,
        type: part.type,
        payload: part,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      })));
      for (const attachment of input.attachments) {
        await upsertMediaUsageWithClient(tx, {
          tenantId: auth.tenantId,
          mediaId: attachment.id,
          resourceType: "ai_message",
          resourceId: userMessage.id,
          usageKind: "attachment",
          userId: auth.userId,
        });
      }
      const [run] = await tx.insert(aiAssistantRuns).values({
        tenantId: auth.tenantId,
        conversationId: conversation.id,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        status: "queued",
        maxAttempts: input.maxAttempts,
        request: {
          includeCrossProject: input.includeCrossProject,
          requestId: auth.requestId,
        },
        createdBy: auth.userId,
        updatedBy: auth.userId,
      }).returning();
      if (!run) throw new Error("Failed to create assistant run");
      await tx.update(aiConversations).set({
        lastSequence: assistantSequence,
        updatedBy: auth.userId,
        updatedAt: new Date(),
      }).where(and(
        eq(aiConversations.id, conversation.id),
        eq(aiConversations.tenantId, auth.tenantId),
        eq(aiConversations.userId, auth.userId),
      ));
      return { conversation, userMessage, assistantMessage, run };
    });
  }

  async listConversations(
    auth: AuthContext,
    pagination: { cursor?: string; limit: number },
  ) {
    let cursorCondition;
    if (pagination.cursor) {
      const [cursor] = await this.db.select({
        id: aiConversations.id,
        updatedAt: aiConversations.updatedAt,
      }).from(aiConversations).where(and(
        eq(aiConversations.id, pagination.cursor),
        eq(aiConversations.tenantId, auth.tenantId),
        eq(aiConversations.userId, auth.userId),
        isNull(aiConversations.deletedAt),
      )).limit(1);
      if (!cursor) throw new ApiError("CONVERSATION_CURSOR_INVALID", "会话游标无效。", 400);
      cursorCondition = or(
        lt(aiConversations.updatedAt, cursor.updatedAt),
        and(eq(aiConversations.updatedAt, cursor.updatedAt), lt(aiConversations.id, cursor.id)),
      );
    }
    const rows = await this.db
      .select()
      .from(aiConversations)
      .where(and(
        eq(aiConversations.tenantId, auth.tenantId),
        eq(aiConversations.userId, auth.userId),
        isNull(aiConversations.deletedAt),
        cursorCondition,
      ))
      .orderBy(desc(aiConversations.updatedAt), desc(aiConversations.id))
      .limit(pagination.limit + 1);
    const hasMore = rows.length > pagination.limit;
    const items = rows.slice(0, pagination.limit);
    return {
      items,
      nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
    };
  }

  async requireConversation(auth: AuthContext, conversationId: string) {
    const [conversation] = await this.db
      .select()
      .from(aiConversations)
      .where(and(
        eq(aiConversations.id, conversationId),
        eq(aiConversations.tenantId, auth.tenantId),
        eq(aiConversations.userId, auth.userId),
        isNull(aiConversations.deletedAt),
      ))
      .limit(1);
    if (!conversation) throw new ApiError("CONVERSATION_NOT_FOUND", "会话不存在。", 404);
    return conversation;
  }

  async deleteConversation(auth: AuthContext, conversationId: string) {
    const conversation = await this.requireConversation(auth, conversationId);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const messages = await tx.select({ id: aiMessages.id }).from(aiMessages).where(and(
        eq(aiMessages.tenantId, auth.tenantId),
        eq(aiMessages.conversationId, conversation.id),
        isNull(aiMessages.deletedAt),
      ));
      if (messages.length > 0) {
        await tx.update(mediaUsages).set({
          deletedAt: now,
          updatedAt: now,
          updatedBy: auth.userId,
        }).where(and(
          eq(mediaUsages.tenantId, auth.tenantId),
          eq(mediaUsages.resourceType, "ai_message"),
          inArray(mediaUsages.resourceId, messages.map((message) => message.id)),
          isNull(mediaUsages.deletedAt),
        ));
      }
      await tx.update(aiConversations).set({
        deletedAt: now,
        updatedAt: now,
        updatedBy: auth.userId,
      }).where(and(
        eq(aiConversations.id, conversation.id),
        eq(aiConversations.tenantId, auth.tenantId),
        eq(aiConversations.userId, auth.userId),
      ));
    });
    return { ok: true };
  }

  async readConversationRows(
    auth: AuthContext,
    conversationId: string,
    pagination?: { cursor?: number; limit: number },
  ) {
    await this.requireConversation(auth, conversationId);
    const messageConditions = and(
      eq(aiMessages.tenantId, auth.tenantId),
      eq(aiMessages.conversationId, conversationId),
      isNull(aiMessages.deletedAt),
      pagination?.cursor ? lt(aiMessages.sequence, pagination.cursor) : undefined,
    );
    const queriedMessages = pagination
      ? await this.db
          .select()
          .from(aiMessages)
          .where(messageConditions)
          .orderBy(desc(aiMessages.sequence))
          .limit(pagination.limit + 1)
      : await this.db
      .select()
      .from(aiMessages)
      .where(messageConditions)
      .orderBy(asc(aiMessages.sequence));
    const hasMore = Boolean(pagination && queriedMessages.length > pagination.limit);
    const messages = pagination
      ? queriedMessages.slice(0, pagination.limit).reverse()
      : queriedMessages;
    const nextCursor = hasMore ? String(messages[0]?.sequence ?? "") : null;
    const ids = messages.map((message) => message.id);
    if (ids.length === 0) return { messages, parts: [], citations: [], nextCursor };
    const [parts, citations] = await Promise.all([
      this.db.select().from(aiMessageParts).where(and(
        eq(aiMessageParts.tenantId, auth.tenantId),
        inArray(aiMessageParts.messageId, ids),
        isNull(aiMessageParts.deletedAt),
      )).orderBy(asc(aiMessageParts.messageId), asc(aiMessageParts.partIndex)),
      this.db.select().from(aiMessageCitations).where(and(
        eq(aiMessageCitations.tenantId, auth.tenantId),
        inArray(aiMessageCitations.messageId, ids),
        isNull(aiMessageCitations.deletedAt),
      )).orderBy(asc(aiMessageCitations.messageId), asc(aiMessageCitations.rank)),
    ]);
    return { messages, parts, citations, nextCursor };
  }

  // 只读回窗口内的消息。会话可以长到几百轮，每轮都全量拉一遍消息、parts 和引用
  // 只为取最后 12 条，是把整段历史的读取成本乘进每一次提问。
  async conversationModelHistory(auth: AuthContext, conversationId: string) {
    await this.requireConversation(auth, conversationId);
    const recent = await this.db
      .select({
        id: aiMessages.id,
        role: aiMessages.role,
        sequence: aiMessages.sequence,
      })
      .from(aiMessages)
      .where(and(
        eq(aiMessages.tenantId, auth.tenantId),
        eq(aiMessages.conversationId, conversationId),
        eq(aiMessages.status, "complete"),
        isNull(aiMessages.deletedAt),
      ))
      .orderBy(desc(aiMessages.sequence))
      .limit(MODEL_HISTORY_MESSAGE_LIMIT);
    if (recent.length === 0) return [];
    const messages = recent.reverse();
    const parts = await this.db
      .select()
      .from(aiMessageParts)
      .where(and(
        eq(aiMessageParts.tenantId, auth.tenantId),
        inArray(aiMessageParts.messageId, messages.map((message) => message.id)),
        isNull(aiMessageParts.deletedAt),
      ))
      .orderBy(asc(aiMessageParts.messageId), asc(aiMessageParts.partIndex));
    const partsByMessage = new Map<string, AiMessagePart[]>();
    for (const part of parts) {
      const existing = partsByMessage.get(part.messageId) ?? [];
      existing.push(part.payload);
      partsByMessage.set(part.messageId, existing);
    }
    return messages.map((message) => ({
      role: message.role as "user" | "assistant",
      parts: partsByMessage.get(message.id) ?? [],
    }));
  }

  async claimRun(auth: AuthContext, runId: string) {
    const now = new Date();
    const leaseId = crypto.randomUUID();
    const run = await this.db.transaction(async (tx) => {
      const [candidate] = await tx.select().from(aiAssistantRuns).where(and(
        eq(aiAssistantRuns.id, runId),
        eq(aiAssistantRuns.tenantId, auth.tenantId),
        inArray(aiAssistantRuns.status, ["queued", "failed"]),
        lte(aiAssistantRuns.nextAttemptAt, now),
        sql`${aiAssistantRuns.attempts} < ${aiAssistantRuns.maxAttempts}`,
        eq(aiAssistantRuns.retryable, true),
        isNull(aiAssistantRuns.deletedAt),
      )).limit(1).for("update");
      if (!candidate) return null;
      const [claimed] = await tx.update(aiAssistantRuns).set({
        status: "running",
        attempts: candidate.attempts + 1,
        processingAt: now,
        leaseId,
        errorCode: null,
        errorMessage: null,
        updatedAt: now,
        updatedBy: auth.userId,
      }).where(eq(aiAssistantRuns.id, candidate.id)).returning();
      // 重跑一律从空的工作过程开始，避免上一次尝试的步骤和这一次混在一起。
      await tx.delete(aiRunSteps).where(and(
        eq(aiRunSteps.runId, candidate.id),
        eq(aiRunSteps.tenantId, auth.tenantId),
      ));
      return claimed ?? null;
    });
    if (!run) throw new ApiError("RUN_NOT_READY", "回答任务当前不可执行。", 409);
    return run;
  }

  async markRetrievalComplete(
    auth: AuthContext,
    runId: string,
    leaseId: string,
    assistantMessageId: string,
    input: {
      citations: AiCitation[];
      trace: Record<string, unknown>;
    },
  ) {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const [run] = await tx.select({ id: aiAssistantRuns.id }).from(aiAssistantRuns).where(and(
        eq(aiAssistantRuns.id, runId),
        eq(aiAssistantRuns.tenantId, auth.tenantId),
        eq(aiAssistantRuns.status, "running"),
        eq(aiAssistantRuns.leaseId, leaseId),
      )).limit(1).for("update");
      if (!run) return false;
      await tx.delete(aiMessageCitations).where(and(
        eq(aiMessageCitations.messageId, assistantMessageId),
        eq(aiMessageCitations.tenantId, auth.tenantId),
      ));
      if (input.citations.length > 0) {
        await tx.insert(aiMessageCitations).values(input.citations.map((citation) => ({
          id: citation.id,
          tenantId: auth.tenantId,
          messageId: assistantMessageId,
          rank: citation.rank,
          sourceType: citation.sourceType,
          sourceId: citation.sourceId,
          projectId: citation.projectId,
          documentId: citation.documentId,
          chunkIndex: citation.chunkIndex,
          blockIds: citation.blockIds,
          headingPath: citation.headingPath,
          titleSnapshot: citation.title,
          snippet: citation.snippet ?? "",
          tier: citation.tier,
          retrieval: citation.retrieval,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        })));
      }
      await tx.insert(aiRetrievalTraces).values({
        tenantId: auth.tenantId,
        messageId: assistantMessageId,
        stages: input.trace,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      }).onConflictDoUpdate({
        target: aiRetrievalTraces.messageId,
        set: { stages: input.trace, updatedAt: now, updatedBy: auth.userId },
      });
      return true;
    });
  }

  // 步骤索引由 kind 在契约里的位置决定，天然稳定，可以直接当 upsert 键用。
  async recordRunStep(auth: AuthContext, runId: string, step: AiRunStep, now = new Date()) {
    const stepIndex = AI_RUN_STEP_KINDS.indexOf(step.kind);
    if (stepIndex < 0) return;
    const completedAt = step.status === "running" ? null : now;
    await this.db.insert(aiRunSteps).values({
      tenantId: auth.tenantId,
      runId,
      stepIndex,
      kind: step.kind,
      status: step.status,
      metadata: { ...step.detail, ...(step.durationMs === null ? {} : { durationMs: step.durationMs }) },
      startedAt: now,
      completedAt,
      createdBy: auth.userId,
      updatedBy: auth.userId,
    }).onConflictDoUpdate({
      target: [aiRunSteps.runId, aiRunSteps.stepIndex],
      set: {
        status: step.status,
        metadata: { ...step.detail, ...(step.durationMs === null ? {} : { durationMs: step.durationMs }) },
        completedAt,
        updatedAt: now,
        updatedBy: auth.userId,
      },
    });
  }

  async readRunSteps(auth: AuthContext, runIds: string[]) {
    if (runIds.length === 0) return [];
    return this.db
      .select()
      .from(aiRunSteps)
      .where(and(
        eq(aiRunSteps.tenantId, auth.tenantId),
        inArray(aiRunSteps.runId, runIds),
        isNull(aiRunSteps.deletedAt),
      ))
      .orderBy(asc(aiRunSteps.runId), asc(aiRunSteps.stepIndex));
  }

  async claimRecoverableRuns(input: {
    batchSize: number;
    processingTimeoutSeconds: number;
    tenantId?: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const staleBefore = new Date(now.getTime() - input.processingTimeoutSeconds * 1000);
    return this.db.transaction(async (tx) => {
      const candidates = await tx.select().from(aiAssistantRuns).where(and(
        input.tenantId ? eq(aiAssistantRuns.tenantId, input.tenantId) : undefined,
        isNull(aiAssistantRuns.deletedAt),
        sql`${aiAssistantRuns.attempts} < ${aiAssistantRuns.maxAttempts}`,
        eq(aiAssistantRuns.retryable, true),
        or(
          and(
            inArray(aiAssistantRuns.status, ["queued", "failed"]),
            lte(aiAssistantRuns.nextAttemptAt, now),
          ),
          and(
            eq(aiAssistantRuns.status, "running"),
            lt(aiAssistantRuns.processingAt, staleBefore),
          ),
        ),
      )).orderBy(asc(aiAssistantRuns.nextAttemptAt), asc(aiAssistantRuns.id))
        .limit(input.batchSize)
        .for("update", { skipLocked: true });
      const claimed: Array<typeof aiAssistantRuns.$inferSelect> = [];
      for (const candidate of candidates) {
        const leaseId = crypto.randomUUID();
        const [run] = await tx.update(aiAssistantRuns).set({
          status: "running",
          attempts: candidate.attempts + 1,
          processingAt: now,
          leaseId,
          completedAt: null,
          errorCode: null,
          errorMessage: null,
          updatedAt: now,
        }).where(eq(aiAssistantRuns.id, candidate.id)).returning();
        if (!run) continue;
        await tx.delete(aiMessageParts).where(and(
          eq(aiMessageParts.tenantId, candidate.tenantId),
          eq(aiMessageParts.messageId, candidate.assistantMessageId),
        ));
        await tx.delete(aiMessageCitations).where(and(
          eq(aiMessageCitations.tenantId, candidate.tenantId),
          eq(aiMessageCitations.messageId, candidate.assistantMessageId),
        ));
        await tx.delete(aiRetrievalTraces).where(and(
          eq(aiRetrievalTraces.tenantId, candidate.tenantId),
          eq(aiRetrievalTraces.messageId, candidate.assistantMessageId),
        ));
        await tx.update(aiMessages).set({
          status: "streaming",
          usage: {},
          updatedAt: now,
        }).where(and(
          eq(aiMessages.tenantId, candidate.tenantId),
          eq(aiMessages.id, candidate.assistantMessageId),
        ));
        await tx.delete(aiRunSteps).where(and(
          eq(aiRunSteps.tenantId, candidate.tenantId),
          eq(aiRunSteps.runId, candidate.id),
        ));
        await tx.insert(aiRunSteps).values({
          tenantId: candidate.tenantId,
          runId: candidate.id,
          stepIndex: 0,
          kind: "retrieval",
          status: "running",
          startedAt: now,
          createdBy: candidate.updatedBy,
          updatedBy: candidate.updatedBy,
        });
        claimed.push(run);
      }
      return claimed;
    });
  }

  async recoveryInput(runId: string) {
    const [row] = await this.db.select({
      run: aiAssistantRuns,
      userId: aiConversations.userId,
      activeProjectId: aiMessages.activeProjectId,
      scopeResolution: aiMessages.scopeResolution,
      role: tenantMemberships.role,
    }).from(aiAssistantRuns)
      .innerJoin(aiConversations, eq(aiAssistantRuns.conversationId, aiConversations.id))
      .innerJoin(aiMessages, eq(aiAssistantRuns.userMessageId, aiMessages.id))
      .innerJoin(tenantMemberships, and(
        eq(tenantMemberships.tenantId, aiAssistantRuns.tenantId),
        eq(tenantMemberships.userId, aiConversations.userId),
        isNull(tenantMemberships.deletedAt),
      ))
      .innerJoin(users, and(
        eq(users.id, aiConversations.userId),
        eq(users.tenantId, aiAssistantRuns.tenantId),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ))
      .where(and(
        eq(aiAssistantRuns.id, runId),
        eq(aiAssistantRuns.status, "running"),
        isNull(aiAssistantRuns.deletedAt),
        isNull(aiConversations.deletedAt),
        isNull(aiMessages.deletedAt),
      ))
      .limit(1);
    if (!row) return null;
    const [part] = await this.db.select().from(aiMessageParts).where(and(
      eq(aiMessageParts.tenantId, row.run.tenantId),
      eq(aiMessageParts.messageId, row.run.userMessageId),
      eq(aiMessageParts.type, "text"),
      isNull(aiMessageParts.deletedAt),
    )).orderBy(asc(aiMessageParts.partIndex)).limit(1);
    if (!part || part.payload.type !== "text") return null;
    return {
      ...row,
      message: part.payload.text,
    };
  }

  async completeRun(
    auth: AuthContext,
    input: {
      runId: string;
      leaseId: string;
      assistantMessageId: string;
      text: string;
      citations: AiCitation[];
      trace: Record<string, unknown>;
      usage: Record<string, unknown>;
    },
  ) {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const [activeRun] = await tx.select({ id: aiAssistantRuns.id }).from(aiAssistantRuns).where(and(
        eq(aiAssistantRuns.id, input.runId),
        eq(aiAssistantRuns.tenantId, auth.tenantId),
        eq(aiAssistantRuns.status, "running"),
        eq(aiAssistantRuns.leaseId, input.leaseId),
      )).limit(1).for("update");
      if (!activeRun) return false;
      const textPart: AiMessagePart = { type: "text", text: input.text };
      await tx.delete(aiMessageParts).where(and(
        eq(aiMessageParts.messageId, input.assistantMessageId),
        eq(aiMessageParts.tenantId, auth.tenantId),
      ));
      await tx.insert(aiMessageParts).values({
        tenantId: auth.tenantId,
        messageId: input.assistantMessageId,
        partIndex: 0,
        type: textPart.type,
        payload: textPart,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      });
      await tx.delete(aiMessageCitations).where(and(
        eq(aiMessageCitations.messageId, input.assistantMessageId),
        eq(aiMessageCitations.tenantId, auth.tenantId),
      ));
      if (input.citations.length > 0) {
        await tx.insert(aiMessageCitations).values(input.citations.map((citation) => ({
          id: citation.id,
          tenantId: auth.tenantId,
          messageId: input.assistantMessageId,
          rank: citation.rank,
          sourceType: citation.sourceType,
          sourceId: citation.sourceId,
          projectId: citation.projectId,
          documentId: citation.documentId,
          chunkIndex: citation.chunkIndex,
          blockIds: citation.blockIds,
          headingPath: citation.headingPath,
          titleSnapshot: citation.title,
          snippet: citation.snippet ?? "",
          tier: citation.tier,
          retrieval: citation.retrieval,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        })));
      }
      await tx.insert(aiRetrievalTraces).values({
        tenantId: auth.tenantId,
        messageId: input.assistantMessageId,
        stages: input.trace,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      }).onConflictDoUpdate({
        target: aiRetrievalTraces.messageId,
        set: { stages: input.trace, updatedAt: now, updatedBy: auth.userId },
      });
      await tx.update(aiMessages).set({
        status: "complete",
        usage: input.usage,
        updatedAt: now,
        updatedBy: auth.userId,
      }).where(and(
        eq(aiMessages.id, input.assistantMessageId),
        eq(aiMessages.tenantId, auth.tenantId),
      ));
      await tx.update(aiAssistantRuns).set({
        status: "complete",
        completedAt: now,
        processingAt: null,
        leaseId: null,
        updatedAt: now,
        updatedBy: auth.userId,
      }).where(and(
        eq(aiAssistantRuns.id, input.runId),
        eq(aiAssistantRuns.tenantId, auth.tenantId),
        eq(aiAssistantRuns.leaseId, input.leaseId),
      ));
      await tx.update(aiRunSteps).set({
        status: "complete",
        completedAt: now,
        updatedAt: now,
        updatedBy: auth.userId,
      }).where(and(
        eq(aiRunSteps.runId, input.runId),
        eq(aiRunSteps.tenantId, auth.tenantId),
        eq(aiRunSteps.stepIndex, 1),
      ));
      await tx.update(aiConversations).set({
        updatedAt: now,
        updatedBy: auth.userId,
      }).where(and(
        eq(aiConversations.tenantId, auth.tenantId),
        eq(aiConversations.userId, auth.userId),
        eq(aiConversations.id, (
        await tx.select({ id: aiAssistantRuns.conversationId })
          .from(aiAssistantRuns)
          .where(and(
            eq(aiAssistantRuns.id, input.runId),
            eq(aiAssistantRuns.tenantId, auth.tenantId),
          ))
          .limit(1)
        )[0]?.id ?? "00000000-0000-0000-0000-000000000000"),
      ));
      return true;
    });
  }

  async failRun(
    auth: AuthContext,
    input: {
      runId: string;
      leaseId: string;
      assistantMessageId: string;
      text: string;
      code: string;
      message: string;
      retryable?: boolean;
    },
  ) {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const [activeRun] = await tx.select({ id: aiAssistantRuns.id, attempts: aiAssistantRuns.attempts }).from(aiAssistantRuns).where(and(
        eq(aiAssistantRuns.id, input.runId),
        eq(aiAssistantRuns.tenantId, auth.tenantId),
        eq(aiAssistantRuns.status, "running"),
        eq(aiAssistantRuns.leaseId, input.leaseId),
      )).limit(1).for("update");
      if (!activeRun) return false;
      await tx.delete(aiMessageParts).where(and(
        eq(aiMessageParts.messageId, input.assistantMessageId),
        eq(aiMessageParts.tenantId, auth.tenantId),
      ));
      const parts: AiMessagePart[] = [
        ...(input.text ? [{ type: "text" as const, text: input.text }] : []),
        { type: "error", code: input.code, message: input.message },
      ];
      await tx.insert(aiMessageParts).values(parts.map((part, partIndex) => ({
        tenantId: auth.tenantId,
        messageId: input.assistantMessageId,
        partIndex,
        type: part.type,
        payload: part,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      })));
      await tx.update(aiMessages).set({
        status: "failed",
        updatedAt: now,
        updatedBy: auth.userId,
      }).where(and(eq(aiMessages.id, input.assistantMessageId), eq(aiMessages.tenantId, auth.tenantId)));
      await tx.update(aiAssistantRuns).set({
        status: "failed",
        processingAt: null,
        leaseId: null,
        errorCode: input.code,
        errorMessage: input.message.slice(0, 1000),
        retryable: input.retryable ?? true,
        nextAttemptAt: new Date(now.getTime() + Math.min(30_000, 2 ** activeRun.attempts * 1_000)),
        updatedAt: now,
        updatedBy: auth.userId,
      }).where(and(
        eq(aiAssistantRuns.id, input.runId),
        eq(aiAssistantRuns.tenantId, auth.tenantId),
        eq(aiAssistantRuns.leaseId, input.leaseId),
      ));
      await tx.update(aiRunSteps).set({
        status: "failed",
        completedAt: now,
        updatedAt: now,
        updatedBy: auth.userId,
      }).where(and(
        eq(aiRunSteps.runId, input.runId),
        eq(aiRunSteps.tenantId, auth.tenantId),
        eq(aiRunSteps.status, "running"),
      ));
      return true;
    });
  }

  async requireRun(auth: AuthContext, runId: string) {
    const [run] = await this.db
      .select()
      .from(aiAssistantRuns)
      .innerJoin(aiConversations, eq(aiAssistantRuns.conversationId, aiConversations.id))
      .where(and(
        eq(aiAssistantRuns.id, runId),
        eq(aiAssistantRuns.tenantId, auth.tenantId),
        eq(aiConversations.tenantId, auth.tenantId),
        eq(aiConversations.userId, auth.userId),
        isNull(aiAssistantRuns.deletedAt),
        isNull(aiConversations.deletedAt),
      ))
      .limit(1);
    if (!run) throw new ApiError("RUN_NOT_FOUND", "回答任务不存在。", 404);
    return run.ai_assistant_runs;
  }

  async retryInput(auth: AuthContext, runId: string) {
    const run = await this.requireRun(auth, runId);
    if (run.status !== "failed") {
      throw new ApiError("RUN_NOT_RETRYABLE", "只有失败的回答任务可以重试。", 409);
    }
    const [message] = await this.db
      .select()
      .from(aiMessages)
      .where(and(eq(aiMessages.id, run.userMessageId), eq(aiMessages.tenantId, auth.tenantId)))
      .limit(1);
    const [part] = await this.db
      .select()
      .from(aiMessageParts)
      .where(and(
        eq(aiMessageParts.messageId, run.userMessageId),
        eq(aiMessageParts.tenantId, auth.tenantId),
        eq(aiMessageParts.type, "text"),
        isNull(aiMessageParts.deletedAt),
      ))
      .limit(1);
    if (!message || !part || part.payload.type !== "text") {
      throw new ApiError("RUN_INPUT_MISSING", "原始问题已不可用。", 409);
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(aiMessageCitations).where(and(
        eq(aiMessageCitations.messageId, run.assistantMessageId),
        eq(aiMessageCitations.tenantId, auth.tenantId),
      ));
      await tx.delete(aiMessageParts).where(and(
        eq(aiMessageParts.messageId, run.assistantMessageId),
        eq(aiMessageParts.tenantId, auth.tenantId),
      ));
      await tx.delete(aiRetrievalTraces).where(and(
        eq(aiRetrievalTraces.messageId, run.assistantMessageId),
        eq(aiRetrievalTraces.tenantId, auth.tenantId),
      ));
      await tx.delete(aiRunSteps).where(and(
        eq(aiRunSteps.runId, run.id),
        eq(aiRunSteps.tenantId, auth.tenantId),
      ));
      await tx.update(aiAssistantRuns).set({
        status: "queued",
        attempts: 0,
        processingAt: null,
        leaseId: null,
        completedAt: null,
        errorCode: null,
        errorMessage: null,
        retryable: true,
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
        updatedBy: auth.userId,
      }).where(and(
        eq(aiAssistantRuns.id, run.id),
        eq(aiAssistantRuns.tenantId, auth.tenantId),
      ));
      await tx.update(aiMessages).set({
        status: "streaming",
        usage: {},
        updatedAt: new Date(),
        updatedBy: auth.userId,
      }).where(and(
        eq(aiMessages.id, run.assistantMessageId),
        eq(aiMessages.tenantId, auth.tenantId),
      ));
    });
    return {
      run,
      message: part.payload.text,
      activeProjectId: message.activeProjectId,
      scopeResolution: message.scopeResolution as KnowledgeScope["resolution"],
      includeCrossProject: run.request.includeCrossProject ?? true,
    };
  }

  async citationFeedbackTarget(auth: AuthContext, citationId: string) {
    const [citation] = await this.db
      .select({ id: aiMessageCitations.id, messageId: aiMessageCitations.messageId })
      .from(aiMessageCitations)
      .innerJoin(aiMessages, eq(aiMessageCitations.messageId, aiMessages.id))
      .innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
      .where(and(
        eq(aiMessageCitations.id, citationId),
        eq(aiMessageCitations.tenantId, auth.tenantId),
        eq(aiMessages.tenantId, auth.tenantId),
        eq(aiConversations.tenantId, auth.tenantId),
        eq(aiConversations.userId, auth.userId),
        isNull(aiMessageCitations.deletedAt),
        isNull(aiMessages.deletedAt),
        isNull(aiConversations.deletedAt),
      ))
      .limit(1);
    if (!citation) throw new ApiError("CITATION_NOT_FOUND", "引用不存在。", 404);
    return citation;
  }

  async writeFeedback(
    auth: AuthContext,
    input: { messageId: string; citationId?: string; feedback: AiFeedback },
  ) {
    const [message] = await this.db
      .select({ id: aiMessages.id })
      .from(aiMessages)
      .innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
      .where(and(
        eq(aiMessages.id, input.messageId),
        eq(aiMessages.tenantId, auth.tenantId),
        eq(aiConversations.tenantId, auth.tenantId),
        eq(aiConversations.userId, auth.userId),
        isNull(aiMessages.deletedAt),
        isNull(aiConversations.deletedAt),
      ))
      .limit(1);
    if (!message) throw new ApiError("MESSAGE_NOT_FOUND", "消息不存在。", 404);
    if (input.citationId) {
      const [citation] = await this.db
        .select({ id: aiMessageCitations.id })
        .from(aiMessageCitations)
        .where(and(
          eq(aiMessageCitations.id, input.citationId),
          eq(aiMessageCitations.messageId, input.messageId),
          eq(aiMessageCitations.tenantId, auth.tenantId),
          isNull(aiMessageCitations.deletedAt),
        ))
        .limit(1);
      if (!citation) throw new ApiError("CITATION_NOT_FOUND", "引用不存在。", 404);
    }
    await this.db.transaction(async (tx) => {
      const targetCondition = input.citationId
        ? eq(aiFeedbackEvents.citationId, input.citationId)
        : sql`${aiFeedbackEvents.citationId} is null`;
      await tx.delete(aiFeedbackEvents).where(and(
        eq(aiFeedbackEvents.tenantId, auth.tenantId),
        eq(aiFeedbackEvents.messageId, input.messageId),
        eq(aiFeedbackEvents.userId, auth.userId),
        targetCondition,
      ));
      await tx.insert(aiFeedbackEvents).values({
        tenantId: auth.tenantId,
        userId: auth.userId,
        messageId: input.messageId,
        citationId: input.citationId ?? null,
        vote: input.feedback.vote,
        reason: input.feedback.reason ?? null,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      });
    });
    await this.recomputeFeedbackScores(auth, input.messageId, input.citationId);
    return { ok: true };
  }

  private async recomputeFeedbackScores(
    auth: AuthContext,
    messageId: string,
    citationId?: string,
  ) {
    const citations = await this.db
      .select({
        id: aiMessageCitations.id,
        sourceType: aiMessageCitations.sourceType,
        sourceId: aiMessageCitations.sourceId,
      })
      .from(aiMessageCitations)
      .where(and(
        eq(aiMessageCitations.tenantId, auth.tenantId),
        eq(aiMessageCitations.messageId, messageId),
        ...(citationId ? [eq(aiMessageCitations.id, citationId)] : []),
      ));
    const uniqueSources = new Map(citations.map((citation) => [
      `${citation.sourceType}:${citation.sourceId}`,
      citation,
    ]));
    for (const citation of uniqueSources.values()) {
      const sourceCitations = await this.db
        .select({ id: aiMessageCitations.id, messageId: aiMessageCitations.messageId })
        .from(aiMessageCitations)
        .where(and(
          eq(aiMessageCitations.tenantId, auth.tenantId),
          eq(aiMessageCitations.sourceType, citation.sourceType),
          eq(aiMessageCitations.sourceId, citation.sourceId),
          isNull(aiMessageCitations.deletedAt),
        ));
      const citationIds = sourceCitations.map((item) => item.id);
      const messageIds = [...new Set(sourceCitations.map((item) => item.messageId))];
      if (citationIds.length === 0 || messageIds.length === 0) continue;
      const events = await this.db
        .select({
          userId: aiFeedbackEvents.userId,
          messageId: aiFeedbackEvents.messageId,
          citationId: aiFeedbackEvents.citationId,
          vote: aiFeedbackEvents.vote,
        })
        .from(aiFeedbackEvents)
        .where(and(
          eq(aiFeedbackEvents.tenantId, auth.tenantId),
          isNull(aiFeedbackEvents.deletedAt),
          or(
            inArray(aiFeedbackEvents.citationId, citationIds),
            and(
              isNull(aiFeedbackEvents.citationId),
              inArray(aiFeedbackEvents.messageId, messageIds),
            ),
          ),
        ));
      const votes = new Map<string, { vote: string; citationSpecific: boolean }>();
      for (const event of events) {
        const key = `${event.userId}:${event.messageId}`;
        const existing = votes.get(key);
        const citationSpecific = event.citationId !== null;
        if (!existing || citationSpecific) votes.set(key, { vote: event.vote, citationSpecific });
      }
      const upCount = [...votes.values()].filter((event) => event.vote === "up").length;
      const downCount = [...votes.values()].filter((event) => event.vote === "down").length;
      await this.db.insert(knowledgeSourceScores).values({
        tenantId: auth.tenantId,
        sourceType: citation.sourceType,
        sourceId: citation.sourceId,
        upCount,
        downCount,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      }).onConflictDoUpdate({
        target: [
          knowledgeSourceScores.tenantId,
          knowledgeSourceScores.sourceType,
          knowledgeSourceScores.sourceId,
        ],
        set: {
          upCount,
          downCount,
          recomputedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: auth.userId,
        },
      });
    }
  }
}
