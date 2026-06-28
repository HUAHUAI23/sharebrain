import {
  Server,
  type onAuthenticatePayload,
  type onStoreDocumentPayload,
} from "@hocuspocus/server";
import { loadServerEnv } from "@sharebrain/config";

const env = loadServerEnv();

type CollabContext = {
  userId: string;
  role: "viewer" | "editor" | "admin";
};

export function createCollabServer() {
  return new Server<CollabContext>({
    name: "sharebrain-collab",
    port: env.COLLAB_PORT,
    async onAuthenticate({ token }: onAuthenticatePayload<CollabContext>) {
      if (!token) {
        throw new Error("协作连接缺少访问令牌。");
      }

      return {
        userId: "framework-user",
        role: "editor",
      };
    },
    async onStoreDocument({ documentName }: onStoreDocumentPayload<CollabContext>) {
      console.info(`collab snapshot queued: ${documentName}`);
    },
  });
}

if (import.meta.main) {
  const server = createCollabServer();
  await server.listen();
  console.info(`ShareBrain Collab listening on ws://localhost:${env.COLLAB_PORT}`);
}
