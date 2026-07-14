// 返回当前用户身份、空间和服务端裁定的能力开关。
import { type AuthContext } from "@sharebrain/contracts";
import { mediaObjects, tenantMemberships, tenants, users } from "@sharebrain/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";

import { ApiError } from "../../app/api-error";
import {
  createGeneratedAvatarDescriptor,
  createUploadedAvatarDescriptor,
  loadUserAvatarDescriptor,
} from "../shared/avatar";
import { serializeUser } from "../shared/serializers";

import type { DatabaseClient } from "@sharebrain/db";
import type { ServerEnv } from "@sharebrain/config";

export class MeService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly env: ServerEnv,
  ) {}

  async getCurrent(auth: AuthContext) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, auth.userId), eq(users.tenantId, auth.tenantId), isNull(users.deletedAt)))
      .limit(1);

    const [tenant] = await this.db
      .select()
      .from(tenants)
      .where(and(eq(tenants.id, auth.tenantId), isNull(tenants.deletedAt)))
      .limit(1);

    if (!user || !tenant) {
      throw new ApiError("AUTH_CONTEXT_NOT_FOUND", "开发用户或空间不存在，请先运行 db:seed。", 401);
    }

    return {
      user: serializeUser(user, await loadUserAvatarDescriptor(this.db, user)),
      tenant: {
        id: tenant.id,
        name: tenant.name,
        kind: tenant.kind as "personal" | "team",
        storageQuotaBytes: tenant.storageQuotaBytes,
      },
      role: auth.role,
      capabilities: {
        activityHistoryRead: this.env.DOCUMENT_ACTIVITY_HISTORY_ENABLED,
        versionHistoryRead: this.env.DOCUMENT_VERSION_HISTORY_ENABLED,
        versionHistoryRestore:
          this.env.DOCUMENT_VERSION_HISTORY_ENABLED &&
          this.env.DOCUMENT_VERSION_RESTORE_ENABLED &&
          (auth.role === "editor" || auth.role === "admin"),
      },
    };
  }

  async listMembers(auth: AuthContext) {
    const rows = await this.db
      .select({
        user: users,
        avatarMediaId: mediaObjects.id,
        avatarByteSize: mediaObjects.byteSize,
      })
      .from(tenantMemberships)
      .innerJoin(
        users,
        and(
          eq(tenantMemberships.userId, users.id),
          eq(tenantMemberships.tenantId, users.tenantId),
          eq(users.status, "active"),
          isNull(users.deletedAt),
        ),
      )
      .leftJoin(
        mediaObjects,
        and(
          eq(users.avatarMediaId, mediaObjects.id),
          eq(mediaObjects.tenantId, auth.tenantId),
          eq(mediaObjects.purpose, "avatar"),
          eq(mediaObjects.status, "active"),
          isNull(mediaObjects.deletedAt),
        ),
      )
      .where(
        and(
          eq(tenantMemberships.tenantId, auth.tenantId),
          isNull(tenantMemberships.deletedAt),
        ),
      )
      .orderBy(asc(users.displayName), asc(users.id));
    return rows.map(({ user, avatarMediaId, avatarByteSize }) =>
      serializeUser(
        user,
        avatarMediaId
          ? createUploadedAvatarDescriptor(user.id, avatarMediaId, avatarByteSize)
          : createGeneratedAvatarDescriptor(user.id),
      ),
    );
  }
}
