// 验证 assistant run 的后台恢复、租约 fencing、失败保真与消息 keyset 分页。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AiCitation, AuthContext, KnowledgeScope } from "@sharebrain/contracts";
import {
  aiAssistantRuns,
  aiConversations,
  aiMessageCitations,
  aiMessageParts,
  aiRetrievalTraces,
  aiRunSteps,
  auditLogs,
  mediaObjects,
  mediaUploads,
  mediaUsages,
  projects,
  tenantMemberships,
  tenants,
  users,
} from "@sharebrain/db/schema";
import { and, eq, inArray } from "drizzle-orm";

import { createTestApp } from "../../test/test-app";
import { AiChatRepository } from "./ai-chat.repository";
import { AiChatService } from "./ai-chat.service";

const tenantId = crypto.randomUUID();
const userId = crypto.randomUUID();
const otherUserId = crypto.randomUUID();
const projectId = crypto.randomUUID();
const testApp = createTestApp({
  ...process.env,
  DEV_AUTH_TENANT_ID: tenantId,
  DEV_AUTH_USER_ID: userId,
  DEV_AUTH_ROLE: "admin",
  AI_EMBEDDING_API_KEY: "",
  AI_EMBEDDING_BASE_URL: "",
  AI_EMBEDDING_MODEL: "",
  AI_RUN_PROCESSING_TIMEOUT_SECONDS: "30",
  AI_RUN_RECOVERY_BATCH_SIZE: "10",
  AI_RUN_MAX_ATTEMPTS: "3",
});
const repository = new AiChatRepository(testApp.db);
const auth: AuthContext = {
  tenantId,
  userId,
  role: "admin",
  requestId: crypto.randomUUID(),
};
const scope: KnowledgeScope = {
  activeProjectId: projectId,
  resolution: "route",
  projectName: "Durable project",
  ambiguousProjects: [],
};

beforeAll(async () => {
  await testApp.db.insert(tenants).values({
    id: tenantId,
    tenantId,
    name: "Durable run tenant",
    createdBy: userId,
    updatedBy: userId,
  });
  await testApp.db.insert(users).values({
    id: userId,
    tenantId,
    email: `${userId}@durable.test`,
    displayName: "Durable User",
    createdBy: userId,
    updatedBy: userId,
  });
  await testApp.db.insert(users).values({
    id: otherUserId,
    tenantId,
    email: `${otherUserId}@durable.test`,
    displayName: "Other Durable User",
    createdBy: otherUserId,
    updatedBy: otherUserId,
  });
  await testApp.db.insert(tenantMemberships).values([
    {
      tenantId,
      userId,
      role: "admin",
      createdBy: userId,
      updatedBy: userId,
    },
    {
      tenantId,
      userId: otherUserId,
      role: "viewer",
      createdBy: otherUserId,
      updatedBy: otherUserId,
    },
  ]);
  await testApp.db.insert(projects).values({
    id: projectId,
    tenantId,
    name: "Durable project",
    ownerId: userId,
    createdBy: userId,
    updatedBy: userId,
  });
});

afterAll(async () => {
  await testApp.db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId));
  await testApp.db.delete(mediaUsages).where(eq(mediaUsages.tenantId, tenantId));
  await testApp.db.delete(aiConversations).where(eq(aiConversations.tenantId, tenantId));
  await testApp.db.delete(mediaUploads).where(eq(mediaUploads.tenantId, tenantId));
  await testApp.db.delete(mediaObjects).where(eq(mediaObjects.tenantId, tenantId));
  await testApp.db.delete(projects).where(eq(projects.tenantId, tenantId));
  await testApp.db.delete(tenantMemberships).where(eq(tenantMemberships.tenantId, tenantId));
  await testApp.db.delete(users).where(eq(users.tenantId, tenantId));
  await testApp.db.delete(tenants).where(eq(tenants.id, tenantId));
  await testApp.close();
});

async function createTurn(message: string, conversationId?: string) {
  return repository.createTurn(auth, {
    ...(conversationId ? { conversationId } : {}),
    message,
    scope,
    includeCrossProject: false,
    maxAttempts: 3,
    attachments: [],
  });
}

function citation(sourceId = projectId): AiCitation {
  return {
    id: crypto.randomUUID(),
    rank: 1,
    sourceType: "project",
    sourceId,
    projectId,
    projectName: "Durable project",
    documentId: null,
    chunkIndex: null,
    blockIds: [],
    headingPath: [],
    title: "Durable project",
    snippet: "durable evidence",
    tier: "active_project",
    retrieval: {
      rrfScore: 1,
      feedbackMultiplier: 1,
      manualMultiplier: 1,
      finalScore: 1,
    },
    available: true,
  };
}

describe("AI chat durable runs", () => {
  test("recovers a queued run without the original HTTP request", async () => {
    const modelServer = Bun.serve({
      port: 0,
      fetch() {
        const chunks = [
          {
            id: "chatcmpl-recovery",
            object: "chat.completion.chunk",
            created: 0,
            model: "test-model",
            choices: [{
              index: 0,
              delta: { role: "assistant", content: "Recovered answer." },
              finish_reason: null,
            }],
          },
          {
            id: "chatcmpl-recovery",
            object: "chat.completion.chunk",
            created: 0,
            model: "test-model",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
          },
        ];
        return new Response(
          `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
    const turn = await createTurn("recover this run");
    const env = {
      ...testApp.env,
      AI_BASE_URL: `${modelServer.url}v1`,
      AI_API_KEY: "test-key",
      AI_MODEL: "test-model",
    };
    try {
      const result = await new AiChatService(testApp.db, env).recoverRuns({ tenantId });
      expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0, fenced: 0 });
      const [run] = await testApp.db.select().from(aiAssistantRuns)
        .where(eq(aiAssistantRuns.id, turn.run.id));
      expect(run).toMatchObject({ status: "complete", attempts: 1, leaseId: null });
      const parts = await testApp.db.select().from(aiMessageParts).where(and(
        eq(aiMessageParts.tenantId, tenantId),
        eq(aiMessageParts.messageId, turn.assistantMessage.id),
      ));
      expect(parts[0]?.payload).toEqual({ type: "text", text: "Recovered answer." });
      const [audit] = await testApp.db.select().from(auditLogs).where(and(
        eq(auditLogs.tenantId, tenantId),
        eq(auditLogs.resourceId, turn.run.id),
      ));
      expect(audit?.metadata).toMatchObject({ promptTokens: 4, completionTokens: 2 });
    } finally {
      modelServer.stop(true);
    }
  });

  test("reclaims a stale run and rejects writes from the old lease", async () => {
    const turn = await createTurn("lease fencing");
    const first = await repository.claimRun(auth, turn.run.id);
    await testApp.db.update(aiAssistantRuns).set({
      processingAt: new Date(Date.now() - 31_000),
    }).where(eq(aiAssistantRuns.id, turn.run.id));
    const [second] = await repository.claimRecoverableRuns({
      batchSize: 1,
      processingTimeoutSeconds: 30,
      tenantId,
    });
    expect(second?.leaseId).toBeTruthy();
    expect(second?.leaseId).not.toBe(first.leaseId);
    expect(await repository.completeRun(auth, {
      runId: turn.run.id,
      leaseId: first.leaseId!,
      assistantMessageId: turn.assistantMessage.id,
      text: "stale",
      citations: [],
      trace: {},
      usage: {},
    })).toBe(false);
    expect(await repository.completeRun(auth, {
      runId: turn.run.id,
      leaseId: second!.leaseId!,
      assistantMessageId: turn.assistantMessage.id,
      text: "current",
      citations: [],
      trace: {},
      usage: {},
    })).toBe(true);
  });

  test("validates attachment ownership and readiness, binds usage, and reads bytes for the model", async () => {
    const validMediaId = crypto.randomUUID();
    const pendingMediaId = crypto.randomUUID();
    const foreignMediaId = crypto.randomUUID();
    await testApp.db.insert(mediaObjects).values([
      {
        id: validMediaId,
        tenantId,
        bucket: "test-bucket",
        objectKey: `attachments/${validMediaId}`,
        fileName: "diagram.png",
        mimeType: "image/png",
        byteSize: 4,
        purpose: "attachment",
        status: "active",
        createdBy: userId,
        updatedBy: userId,
      },
      {
        id: pendingMediaId,
        tenantId,
        bucket: "test-bucket",
        objectKey: `attachments/${pendingMediaId}`,
        fileName: "pending.png",
        mimeType: "image/png",
        byteSize: 4,
        purpose: "attachment",
        status: "uploading",
        createdBy: userId,
        updatedBy: userId,
      },
      {
        id: foreignMediaId,
        tenantId,
        bucket: "test-bucket",
        objectKey: `attachments/${foreignMediaId}`,
        fileName: "foreign.png",
        mimeType: "image/png",
        byteSize: 4,
        purpose: "attachment",
        status: "active",
        createdBy: otherUserId,
        updatedBy: otherUserId,
      },
    ]);
    let modelRequest = "";
    const modelServer = Bun.serve({
      port: 0,
      async fetch(request) {
        modelRequest = await request.text();
        const chunk = {
          id: "chatcmpl-attachment",
          object: "chat.completion.chunk",
          created: 0,
          model: "test-model",
          choices: [{ index: 0, delta: { content: "Attachment received." }, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        };
        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    const env = {
      ...testApp.env,
      AI_BASE_URL: `${modelServer.url}v1`,
      AI_API_KEY: "test-key",
      AI_MODEL: "test-model",
    };
    const service = new AiChatService(testApp.db, env, {
      async getObjectBytes(bucket, key) {
        expect(bucket).toBe("test-bucket");
        expect(key).toBe(`attachments/${validMediaId}`);
        return new Uint8Array([1, 2, 3, 4]);
      },
    });
    try {
      await expect(service.streamChat(auth, {
        message: "pending attachment",
        activeProjectId: projectId,
        includeCrossProject: false,
        attachments: [pendingMediaId],
      })).rejects.toMatchObject({ code: "CHAT_ATTACHMENT_INVALID" });
      await expect(service.streamChat(auth, {
        message: "foreign attachment",
        activeProjectId: projectId,
        includeCrossProject: false,
        attachments: [foreignMediaId],
      })).rejects.toMatchObject({ code: "CHAT_ATTACHMENT_INVALID" });
      const response = await service.streamChat(auth, {
        message: "read this attachment",
        activeProjectId: projectId,
        includeCrossProject: false,
        attachments: [validMediaId],
      });
      expect((await response.text())).toContain("Attachment received");
      expect(modelRequest).toContain("AQIDBA==");
      const [usage] = await testApp.db.select().from(mediaUsages).where(and(
        eq(mediaUsages.tenantId, tenantId),
        eq(mediaUsages.mediaId, validMediaId),
        eq(mediaUsages.resourceType, "ai_message"),
        eq(mediaUsages.usageKind, "attachment"),
      ));
      expect(usage).toBeTruthy();
      const ownerRead = await testApp.app.request(`/api/media/${validMediaId}/url`, {
        headers: {
          "x-dev-tenant-id": tenantId,
          "x-dev-user-id": userId,
          "x-dev-role": "admin",
        },
      });
      expect(ownerRead.status).toBe(200);
      const foreignRead = await testApp.app.request(`/api/media/${validMediaId}/url`, {
        headers: {
          "x-dev-tenant-id": tenantId,
          "x-dev-user-id": otherUserId,
          "x-dev-role": "viewer",
        },
      });
      expect(foreignRead.status).toBe(404);
      const viewerUpload = await testApp.app.request("/api/media/uploads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dev-tenant-id": tenantId,
          "x-dev-user-id": otherUserId,
          "x-dev-role": "viewer",
        },
        body: JSON.stringify({
          fileName: "viewer-note.txt",
          mimeType: "text/plain",
          byteSize: 8,
          usageKind: "attachment",
        }),
      });
      expect(viewerUpload.status).toBe(201);
    } finally {
      modelServer.stop(true);
    }
  });

  test("keeps partial text, citations, and trace when generation fails", async () => {
    const turn = await createTurn("preserve retrieval");
    const run = await repository.claimRun(auth, turn.run.id);
    const cited = citation();
    expect(await repository.markRetrievalComplete(
      auth,
      run.id,
      run.leaseId!,
      turn.assistantMessage.id,
      { citations: [cited], trace: { fused: [cited.sourceId] } },
    )).toBe(true);
    await repository.recordRunStep(auth, run.id, {
      kind: "generation",
      status: "running",
      detail: {},
      durationMs: null,
    });
    expect(await repository.failRun(auth, {
      runId: run.id,
      leaseId: run.leaseId!,
      assistantMessageId: turn.assistantMessage.id,
      text: "partial answer",
      code: "AI_GENERATION_FAILED",
      message: "generation failed",
    })).toBe(true);
    const [parts, citations, traces, steps] = await Promise.all([
      testApp.db.select().from(aiMessageParts).where(eq(aiMessageParts.messageId, turn.assistantMessage.id)),
      testApp.db.select().from(aiMessageCitations).where(eq(aiMessageCitations.messageId, turn.assistantMessage.id)),
      testApp.db.select().from(aiRetrievalTraces).where(eq(aiRetrievalTraces.messageId, turn.assistantMessage.id)),
      testApp.db.select().from(aiRunSteps).where(eq(aiRunSteps.runId, run.id)),
    ]);
    expect(parts.map((part) => part.payload)).toEqual([
      { type: "text", text: "partial answer" },
      { type: "error", code: "AI_GENERATION_FAILED", message: "generation failed" },
    ]);
    expect(citations).toHaveLength(1);
    expect(traces[0]?.stages).toEqual({ fused: [cited.sourceId] });
    expect(steps).toContainEqual(expect.objectContaining({ kind: "generation", status: "failed" }));
  });

  test("paginates older messages by sequence without gaps", async () => {
    const first = await createTurn("page one");
    await createTurn("page two", first.conversation.id);
    await createTurn("page three", first.conversation.id);
    const newest = await repository.readConversationRows(auth, first.conversation.id, { limit: 2 });
    expect(newest.messages.map((message) => message.sequence)).toEqual([5, 6]);
    expect(newest.nextCursor).toBe("5");
    const older = await repository.readConversationRows(auth, first.conversation.id, {
      cursor: Number(newest.nextCursor),
      limit: 2,
    });
    expect(older.messages.map((message) => message.sequence)).toEqual([3, 4]);
    expect(older.nextCursor).toBe("3");
    const oldest = await repository.readConversationRows(auth, first.conversation.id, {
      cursor: Number(older.nextCursor),
      limit: 2,
    });
    expect(oldest.messages.map((message) => message.sequence)).toEqual([1, 2]);
    expect(oldest.nextCursor).toBeNull();
    const allSequences = [newest, older, oldest]
      .flatMap((page) => page.messages.map((message) => message.sequence));
    expect(new Set(allSequences).size).toBe(6);
    expect(allSequences.sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("paginates conversations by updated time and id", async () => {
    const first = await createTurn("conversation page one");
    const second = await createTurn("conversation page two");
    const third = await createTurn("conversation page three");
    await testApp.db.update(aiConversations).set({
      updatedAt: new Date("2099-03-03T00:00:00.000Z"),
    }).where(eq(aiConversations.id, first.conversation.id));
    await testApp.db.update(aiConversations).set({
      updatedAt: new Date("2099-03-02T00:00:00.000Z"),
    }).where(eq(aiConversations.id, second.conversation.id));
    await testApp.db.update(aiConversations).set({
      updatedAt: new Date("2099-03-01T00:00:00.000Z"),
    }).where(eq(aiConversations.id, third.conversation.id));

    const newest = await repository.listConversations(auth, { limit: 2 });
    expect(newest.items.map((conversation) => conversation.id)).toEqual([
      first.conversation.id,
      second.conversation.id,
    ]);
    expect(newest.nextCursor).toBe(second.conversation.id);
    const older = await repository.listConversations(auth, {
      cursor: newest.nextCursor!,
      limit: 1,
    });
    expect(older.items[0]?.id).toBe(third.conversation.id);
  });

  test("does not claim runs that exhausted their attempt budget", async () => {
    const turn = await createTurn("attempt budget");
    await testApp.db.update(aiAssistantRuns).set({
      status: "failed",
      attempts: 3,
      maxAttempts: 3,
      nextAttemptAt: new Date(0),
    }).where(eq(aiAssistantRuns.id, turn.run.id));
    const claimed = await repository.claimRecoverableRuns({
      batchSize: 10,
      processingTimeoutSeconds: 30,
      tenantId,
    });
    expect(claimed.map((run) => run.id)).not.toContain(turn.run.id);
    const [persisted] = await testApp.db.select().from(aiAssistantRuns).where(and(
      eq(aiAssistantRuns.tenantId, tenantId),
      inArray(aiAssistantRuns.id, [turn.run.id]),
    ));
    expect(persisted).toMatchObject({ status: "failed", attempts: 3 });
  });
});
