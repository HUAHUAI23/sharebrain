import { createHash } from "node:crypto";

import type { ServerEnv } from "@sharebrain/config";
import type { DatabaseClient } from "@sharebrain/db";
import { authSessions, documents, tenantMemberships } from "@sharebrain/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";

export type CollabRole = "viewer" | "editor" | "admin" | "auditor";

export type CollabContext = {
  userId: string;
  tenantId: string;
  role: CollabRole;
  documentId: string;
};

const DOCUMENT_ROOM_PREFIX = "document:";

export function parseDocumentRoom(documentName: string) {
  if (!documentName.startsWith(DOCUMENT_ROOM_PREFIX)) {
    return null;
  }

  const documentId = documentName.slice(DOCUMENT_ROOM_PREFIX.length);

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId)
    ? documentId
    : null;
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) {
    return {};
  }

  return Object.fromEntries(
    header
      .split(";")
      .map((pair) => pair.trim().split("="))
      .filter((pair): pair is [string, string] => pair.length === 2 && Boolean(pair[0])),
  );
}

async function resolveSessionUser(db: DatabaseClient, sessionToken: string | undefined) {
  if (!sessionToken) {
    return null;
  }

  const tokenHash = createHash("sha256").update(sessionToken).digest("hex");
  const [session] = await db
    .select()
    .from(authSessions)
    .where(
      and(
        eq(authSessions.tokenHash, tokenHash),
        isNull(authSessions.deletedAt),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session) {
    return null;
  }

  const [membership] = await db
    .select()
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.tenantId, session.tenantId),
        eq(tenantMemberships.userId, session.userId),
        isNull(tenantMemberships.deletedAt),
      ),
    )
    .limit(1);

  if (!membership) {
    return null;
  }

  return {
    userId: session.userId,
    tenantId: session.tenantId,
    role: membership.role as CollabRole,
  };
}

export async function resolveCollabContext(
  db: DatabaseClient,
  env: ServerEnv,
  { documentName, requestHeaders }: { documentName: string; requestHeaders: Headers },
): Promise<CollabContext> {
  const documentId = parseDocumentRoom(documentName);

  if (!documentId) {
    throw new Error("非法的协作房间名。");
  }

  const cookies = parseCookies(requestHeaders.get("cookie"));
  let user = await resolveSessionUser(db, cookies[env.AUTH_SESSION_COOKIE_NAME]);

  if (!user && env.AUTH_DEV_BYPASS_ENABLED) {
    user = {
      userId: env.DEV_AUTH_USER_ID,
      tenantId: env.DEV_AUTH_TENANT_ID,
      role: env.DEV_AUTH_ROLE,
    };
  }

  if (!user) {
    throw new Error("协作连接未认证。");
  }

  const [document] = await db
    .select({ id: documents.id, tenantId: documents.tenantId })
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);

  if (!document || document.tenantId !== user.tenantId) {
    throw new Error("没有该文档的协作权限。");
  }

  return { ...user, documentId };
}
