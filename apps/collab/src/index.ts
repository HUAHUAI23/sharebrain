// 装配 Hocuspocus 的认证、加载、保存和版本恢复生命周期。
import "@sharebrain/config/dotenv";

import {
  Server,
  type Connection,
  type onAuthenticatePayload,
  type onLoadDocumentPayload,
  type onChangePayload,
  type onStoreDocumentPayload,
} from "@hocuspocus/server";
import { loadServerEnv } from "@sharebrain/config";
import { createDatabaseClient } from "@sharebrain/db";
import * as Y from "yjs";

import { type CollabContext, resolveCollabContext } from "./auth";
import { DocumentActivityTracker } from "./document-activity-tracker";
import { loadDocumentSnapshot, storeDocumentSnapshot } from "./document-store";
import {
  executeDocumentVersionOperation,
  isDocumentRestoreGated,
  parseExecuteVersionOperation,
  resumeDocumentVersionOperation,
} from "./version-operations";

const env = loadServerEnv();

export function createCollabServer(
  db = createDatabaseClient(env.DATABASE_URL),
  configuration = env,
) {
  assertRestoreTopology(configuration);
  const activityTracker = new DocumentActivityTracker();
  const executeWindows = new WeakMap<Connection, { count: number; startedAt: number }>();
  let server: Server<CollabContext>;
  server = new Server<CollabContext>({
    name: "sharebrain-collab",
    port: configuration.COLLAB_PORT,
    // onStoreDocument 由 Hocuspocus 防抖（默认 2s/10s），不在每次击键时落库。
    async onAuthenticate({
      documentName,
      requestHeaders,
      connectionConfig,
    }: onAuthenticatePayload<CollabContext>) {
      const context = await resolveCollabContext(db, configuration, { documentName, requestHeaders });

      if (context.role === "viewer" || context.role === "auditor") {
        connectionConfig.readOnly = true;
      }

      return context;
    },
    async onLoadDocument({ context, document }: onLoadDocumentPayload<CollabContext>) {
      const snapshot = await loadDocumentSnapshot(db, context);

      if (snapshot) {
        Y.applyUpdate(document, snapshot);
      }

      if (configuration.DOCUMENT_VERSION_RESTORE_ENABLED) {
        await resumeDocumentVersionOperation(db, document, context);
      }

      if (configuration.DOCUMENT_ACTIVITY_HISTORY_ENABLED) {
        activityTracker.initialize(document.name, document);
      }

      return document;
    },
    async onChange({ document, documentName, context, update }: onChangePayload<CollabContext>) {
      if (!configuration.DOCUMENT_ACTIVITY_HISTORY_ENABLED) return;
      activityTracker.capture({ document, documentName, context, update });
    },
    async beforeHandleMessage({ documentName }) {
      if (isDocumentRestoreGated(documentName)) {
        throw new Error("DOCUMENT_VERSION_OPERATION_APPLYING");
      }
    },
    async onStateless({ connection, document, documentName, payload }) {
      const message = parseExecuteVersionOperation(payload);
      if (!configuration.DOCUMENT_VERSION_RESTORE_ENABLED) {
        connection.sendStateless(
          JSON.stringify({
            type: "document.version.operation.ack",
            operationId: message.operationId,
            status: "failed",
            resultVersionNo: null,
            errorCode: "DOCUMENT_VERSION_RESTORE_DISABLED",
          }),
        );
        return;
      }
      const now = Date.now();
      const window = executeWindows.get(connection);
      if (window && now - window.startedAt < 60_000 && window.count >= 10) {
        throw new Error("DOCUMENT_VERSION_OPERATION_RATE_LIMITED");
      }
      executeWindows.set(
        connection,
        window && now - window.startedAt < 60_000
          ? { ...window, count: window.count + 1 }
          : { count: 1, startedAt: now },
      );
      try {
        const ack = await executeDocumentVersionOperation(
          db,
          document,
          connection.context as CollabContext,
          message.operationId,
        );
        connection.sendStateless(JSON.stringify(ack));
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "document.version.restore_failed",
            documentName,
            operationId: message.operationId,
            reason: error instanceof Error ? error.message : "unknown",
          }),
        );
        connection.sendStateless(
          JSON.stringify({
            type: "document.version.operation.ack",
            operationId: message.operationId,
            status: "failed",
            resultVersionNo: null,
            errorCode: "DOCUMENT_VERSION_OPERATION_EXECUTION_FAILED",
          }),
        );
        server.hocuspocus.closeConnections(documentName);
        setTimeout(() => void server.hocuspocus.unloadDocument(document), 100);
      }
    },
    async onStoreDocument({ document, documentName, lastContext }: onStoreDocumentPayload<CollabContext>) {
      if (!lastContext) {
        console.warn(`collab store skipped, missing context for ${documentName}`);
        return;
      }

      const activityDrain = configuration.DOCUMENT_ACTIVITY_HISTORY_ENABLED
        ? activityTracker.beginDrain(documentName, document)
        : null;
      try {
        await storeDocumentSnapshot(db, lastContext, document, {
          activityBatches: activityDrain?.batches ?? [],
        });
        if (activityDrain) activityTracker.commitDrain(documentName, activityDrain.token);
      } catch (error) {
        if (activityDrain) activityTracker.rollbackDrain(documentName, activityDrain.token);
        console.error(`collab store failed for ${documentName}`, error);
        throw error;
      }
    },
    async afterUnloadDocument({ documentName }) {
      activityTracker.remove(documentName);
    },
  });
  return server;
}

export function assertRestoreTopology(configuration: typeof env) {
  if (
    configuration.DOCUMENT_VERSION_RESTORE_ENABLED &&
    configuration.COLLAB_REPLICA_COUNT > 1 &&
    !configuration.COLLAB_SHARED_SYNC_ENABLED
  ) {
    throw new Error("Version restore requires a single collab replica until shared sync is enabled");
  }
}

if (import.meta.main) {
  const server = createCollabServer();
  await server.listen();
  console.info(
    JSON.stringify({
      event: "document.version.restore_topology",
      enabled: env.DOCUMENT_VERSION_RESTORE_ENABLED,
      declaredReplicaCount: env.COLLAB_REPLICA_COUNT,
      sharedSyncEnabled: env.COLLAB_SHARED_SYNC_ENABLED,
    }),
  );
  console.info(`ShareBrain Collab listening on ws://localhost:${env.COLLAB_PORT}`);
}
