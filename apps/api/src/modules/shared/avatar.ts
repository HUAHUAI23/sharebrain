// 统一生成头像的缓存版本和用户头像描述，避免认证与账户接口产生不同展示结果。
import type { User } from "@sharebrain/contracts";
import { mediaObjects } from "@sharebrain/db/schema";
import { and, eq, isNull } from "drizzle-orm";

import type { DatabaseClient } from "@sharebrain/db";
import type { users } from "@sharebrain/db/schema";

export const GENERATED_AVATAR_VERSION = "notionists-neutral-v1";

export function createGeneratedAvatarDescriptor(userId: string): User["avatar"] {
  return {
    kind: "generated",
    url: `/api/users/${userId}/avatar/raw?v=${GENERATED_AVATAR_VERSION}`,
    version: GENERATED_AVATAR_VERSION,
    byteSize: null,
  };
}

export function createUploadedAvatarDescriptor(
  userId: string,
  mediaId: string,
  byteSize: number | null,
): User["avatar"] {
  return {
    kind: "uploaded",
    url: `/api/users/${userId}/avatar/raw?v=${mediaId}`,
    version: mediaId,
    byteSize,
  };
}

export async function loadUserAvatarDescriptor(
  db: DatabaseClient,
  user: Pick<typeof users.$inferSelect, "id" | "tenantId" | "avatarMediaId">,
) {
  if (!user.avatarMediaId) {
    return createGeneratedAvatarDescriptor(user.id);
  }

  const [media] = await db
    .select({ id: mediaObjects.id, byteSize: mediaObjects.byteSize })
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.id, user.avatarMediaId),
        eq(mediaObjects.tenantId, user.tenantId),
        eq(mediaObjects.purpose, "avatar"),
        eq(mediaObjects.status, "active"),
        isNull(mediaObjects.deletedAt),
      ),
    )
    .limit(1);

  return media
    ? createUploadedAvatarDescriptor(user.id, media.id, media.byteSize)
    : createGeneratedAvatarDescriptor(user.id);
}
