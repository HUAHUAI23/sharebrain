import "@sharebrain/config/dotenv";

import {
  Server,
  type onAuthenticatePayload,
  type onLoadDocumentPayload,
  type onStoreDocumentPayload,
} from "@hocuspocus/server";
import { loadServerEnv } from "@sharebrain/config";
import { createDatabaseClient } from "@sharebrain/db";
import * as Y from "yjs";

import { type CollabContext, resolveCollabContext } from "./auth";
import { loadDocumentSnapshot, storeDocumentSnapshot } from "./document-store";

const env = loadServerEnv();

export function createCollabServer(db = createDatabaseClient(env.DATABASE_URL)) {
  return new Server<CollabContext>({
    name: "sharebrain-collab",
    port: env.COLLAB_PORT,
    // onStoreDocument 由 Hocuspocus 防抖（默认 2s/10s），不在每次击键时落库。
    async onAuthenticate({
      documentName,
      requestHeaders,
      connectionConfig,
    }: onAuthenticatePayload<CollabContext>) {
      const context = await resolveCollabContext(db, env, { documentName, requestHeaders });

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

      return document;
    },
    async onStoreDocument({ document, documentName, lastContext }: onStoreDocumentPayload<CollabContext>) {
      if (!lastContext) {
        console.warn(`collab store skipped, missing context for ${documentName}`);
        return;
      }

      try {
        await storeDocumentSnapshot(db, lastContext, document);
      } catch (error) {
        console.error(`collab store failed for ${documentName}`, error);
      }
    },
  });
}

if (import.meta.main) {
  const server = createCollabServer();
  await server.listen();
  console.info(`ShareBrain Collab listening on ws://localhost:${env.COLLAB_PORT}`);
}
