import {
  completeMediaUploadRequestSchema,
  createMediaUploadRequestSchema,
  type AuthContext,
  type MediaPurpose,
  type StorageSummary,
} from "@sharebrain/contracts";
import { upsertMediaUsageWithClient } from "@sharebrain/db";
import {
  documents,
  mediaDeletionJobs,
  mediaObjects,
  mediaUploads,
  mediaUsages,
  tenants,
  users,
} from "@sharebrain/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import sharp from "sharp";

import { ApiError } from "../../app/api-error";
import { parseJson } from "../../app/validation";
import { serializeMediaObject } from "../shared/serializers";
import { StorageService } from "./storage.service";

import type { ServerEnv } from "@sharebrain/config";
import type { DatabaseClient } from "@sharebrain/db";

type MediaStorage = Pick<
  StorageService,
  "createPostPolicy" | "createReadUrl" | "headObject" | "getObjectBytes" | "putObject"
>;

const avatarMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const countedMediaStatuses = ["uploading", "active", "pending_delete", "deleting"];
export const AVATAR_NORMALIZED_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_MAX_INPUT_PIXELS = 4096 * 4096;

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
}

function assertCanWriteContent(auth: AuthContext) {
  if (auth.role === "viewer" || auth.role === "auditor") {
    throw new ApiError("FORBIDDEN", "当前账号没有编辑权限。", 403);
  }
}

function assertAvatarUpload(mimeType: string, byteSize: number, maxBytes: number) {
  if (!avatarMimeTypes.has(mimeType)) {
    throw new ApiError("AVATAR_TYPE_UNSUPPORTED", "头像仅支持 JPEG、PNG 或 WebP。", 422);
  }
  if (byteSize > maxBytes) {
    throw new ApiError("MEDIA_TOO_LARGE", "头像文件超过允许大小。", 422, { maxBytes });
  }
}

export class MediaService {
  private readonly storage: MediaStorage;

  constructor(
    private readonly db: DatabaseClient,
    private readonly env: ServerEnv,
    storage?: MediaStorage,
  ) {
    this.storage = storage ?? new StorageService(env);
  }

  async createUpload(auth: AuthContext, input: unknown) {
    const payload = parseJson(createMediaUploadRequestSchema, input);
    if (payload.usageKind === "inline") {
      assertCanWriteContent(auth);
    } else {
      assertAvatarUpload(payload.mimeType, payload.byteSize, this.env.MEDIA_AVATAR_MAX_BYTES);
    }

    const maxBytes = payload.usageKind === "avatar" ? this.env.MEDIA_AVATAR_MAX_BYTES : this.env.MEDIA_UPLOAD_MAX_BYTES;
    if (payload.byteSize > maxBytes) {
      throw new ApiError("MEDIA_TOO_LARGE", "文件超过允许大小。", 422, { maxBytes });
    }

    const now = new Date();
    const mediaId = crypto.randomUUID();
    const safeName = sanitizeFileName(payload.fileName);
    const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const objectKey = `tenants/${auth.tenantId}/media/${month}/${mediaId}/${safeName}`;
    const reservationBytes =
      payload.usageKind === "avatar"
        ? Math.max(
            payload.byteSize,
            Math.min(AVATAR_NORMALIZED_MAX_BYTES, this.env.MEDIA_AVATAR_MAX_BYTES),
          )
        : payload.byteSize;
    const expiresAt = new Date(now.getTime() + this.env.MEDIA_UPLOAD_EXPIRES_SECONDS * 1000);

    const result = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from tenants where id = ${auth.tenantId} for update`);
      const [tenant] = await tx
        .select({ quotaBytes: tenants.storageQuotaBytes })
        .from(tenants)
        .where(eq(tenants.id, auth.tenantId))
        .limit(1);
      if (!tenant) {
        throw new ApiError("TENANT_NOT_FOUND", "当前空间不存在。", 404);
      }

      const [usage] = await tx
        .select({ bytes: sql<number>`coalesce(sum(${mediaObjects.byteSize}), 0)` })
        .from(mediaObjects)
        .where(
          and(
            eq(mediaObjects.tenantId, auth.tenantId),
            inArray(mediaObjects.status, countedMediaStatuses),
          ),
        );
      const projectedBytes = Number(usage?.bytes ?? 0) + reservationBytes;
      if (projectedBytes > tenant.quotaBytes) {
        throw new ApiError("STORAGE_QUOTA_EXCEEDED", "当前空间存储容量不足。", 422, {
          quotaBytes: tenant.quotaBytes,
          projectedBytes,
        });
      }

      const policy = await this.storage.createPostPolicy({
        key: objectKey,
        mimeType: payload.mimeType,
        maxBytes: payload.byteSize,
        expiresSeconds: this.env.MEDIA_UPLOAD_EXPIRES_SECONDS,
      });

      const [media] = await tx
        .insert(mediaObjects)
        .values({
          id: mediaId,
          tenantId: auth.tenantId,
          bucket: this.env.S3_BUCKET,
          objectKey,
          fileName: payload.fileName,
          mimeType: payload.mimeType,
          byteSize: reservationBytes,
          purpose: payload.usageKind,
          status: "uploading",
          metadata: {},
          createdBy: auth.userId,
          updatedBy: auth.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!media) {
        throw new ApiError("MEDIA_CREATE_FAILED", "媒体对象创建失败。", 500);
      }

      const [upload] = await tx
        .insert(mediaUploads)
        .values({
          tenantId: auth.tenantId,
          mediaId: media.id,
          status: "pending",
          uploadUrl: policy.url,
          policyFields: policy.fields,
          maxBytes: payload.byteSize,
          expectedMimeType: payload.mimeType,
          expiresAt,
          createdBy: auth.userId,
          updatedBy: auth.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!upload) {
        throw new ApiError("MEDIA_UPLOAD_CREATE_FAILED", "上传会话创建失败。", 500);
      }
      return { media, policy, upload };
    });

    return {
      uploadId: result.upload.id,
      mediaId: result.media.id,
      url: result.policy.url,
      fields: result.policy.fields,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async completeUpload(auth: AuthContext, uploadId: string, input: unknown) {
    const payload = parseJson(completeMediaUploadRequestSchema, input);
    const [upload] = await this.db
      .select({ upload: mediaUploads, media: mediaObjects })
      .from(mediaUploads)
      .innerJoin(mediaObjects, eq(mediaUploads.mediaId, mediaObjects.id))
      .where(
        and(
          eq(mediaUploads.id, uploadId),
          eq(mediaUploads.tenantId, auth.tenantId),
          eq(mediaUploads.createdBy, auth.userId),
          eq(mediaObjects.createdBy, auth.userId),
          isNull(mediaUploads.deletedAt),
        ),
      )
      .limit(1);
    if (!upload) {
      throw new ApiError("MEDIA_UPLOAD_NOT_FOUND", "上传会话不存在。", 404);
    }
    if (upload.upload.status === "completed") {
      return serializeMediaObject(upload.media);
    }
    if (upload.upload.status !== "pending") {
      throw new ApiError("MEDIA_UPLOAD_NOT_FOUND", "上传会话不可用。", 404);
    }
    if (upload.upload.expiresAt < new Date()) {
      throw new ApiError("MEDIA_UPLOAD_EXPIRED", "上传会话已过期。", 422);
    }
    if (payload.byteSize > upload.upload.maxBytes || payload.mimeType !== upload.upload.expectedMimeType) {
      throw new ApiError("MEDIA_UPLOAD_MISMATCH", "上传文件与会话限制不匹配。", 422);
    }
    if (upload.media.purpose === "inline" && !payload.usage) {
      throw new ApiError("MEDIA_USAGE_REQUIRED", "内嵌媒体必须绑定文档引用。", 422);
    }
    if (payload.usage) {
      assertCanWriteContent(auth);
      if (payload.usage.usageKind !== upload.media.purpose) {
        throw new ApiError("MEDIA_USAGE_MISMATCH", "媒体引用类型与上传用途不匹配。", 422);
      }
      await this.ensureDocumentUsageTarget(auth, payload.usage.resourceId);
    }

    try {
      const head = await this.storage.headObject(upload.media.bucket, upload.media.objectKey);
      if (head.ContentLength === undefined || head.ContentLength !== payload.byteSize) {
        throw new ApiError("MEDIA_UPLOAD_SIZE_MISMATCH", "对象大小校验失败。", 422);
      }
      if (!head.ContentType || head.ContentType !== payload.mimeType) {
        throw new ApiError("MEDIA_UPLOAD_TYPE_MISMATCH", "对象类型校验失败。", 422);
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("MEDIA_OBJECT_UNAVAILABLE", "无法确认对象已上传。", 422);
    }

    let storedByteSize = payload.byteSize;
    let storedMimeType = payload.mimeType;
    let storedFileName = upload.media.fileName;
    if (upload.media.purpose === "avatar") {
      assertAvatarUpload(payload.mimeType, payload.byteSize, this.env.MEDIA_AVATAR_MAX_BYTES);
      try {
        const source = await this.storage.getObjectBytes(upload.media.bucket, upload.media.objectKey);
        const normalized = await sharp(source, {
          failOn: "error",
          limitInputPixels: AVATAR_MAX_INPUT_PIXELS,
        })
          .rotate()
          .resize(512, 512, { fit: "cover", position: "centre" })
          .webp({ quality: 86 })
          .toBuffer();
        const normalizedMaxBytes = Math.min(
          AVATAR_NORMALIZED_MAX_BYTES,
          this.env.MEDIA_AVATAR_MAX_BYTES,
        );
        if (normalized.byteLength > normalizedMaxBytes) {
          throw new ApiError("AVATAR_IMAGE_TOO_COMPLEX", "头像规范化结果超过允许大小。", 422, {
            maxBytes: normalizedMaxBytes,
          });
        }
        await this.storage.putObject({
          bucket: upload.media.bucket,
          key: upload.media.objectKey,
          body: normalized,
          mimeType: "image/webp",
          cacheControl: "private, max-age=31536000, immutable",
        });
        storedByteSize = normalized.byteLength;
        storedMimeType = "image/webp";
        storedFileName = "avatar.webp";
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError("AVATAR_IMAGE_INVALID", "无法解析头像图片。", 422);
      }
    }

    const now = new Date();
    const media = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from media_uploads where id = ${upload.upload.id} for update`);
      await tx.execute(sql`select id from media_objects where id = ${upload.media.id} for update`);
      const [current] = await tx
        .select({ upload: mediaUploads, media: mediaObjects })
        .from(mediaUploads)
        .innerJoin(mediaObjects, eq(mediaUploads.mediaId, mediaObjects.id))
        .where(
          and(
            eq(mediaUploads.id, upload.upload.id),
            eq(mediaUploads.tenantId, auth.tenantId),
            eq(mediaUploads.createdBy, auth.userId),
            eq(mediaObjects.createdBy, auth.userId),
            isNull(mediaUploads.deletedAt),
          ),
        )
        .limit(1);
      if (!current) {
        throw new ApiError("MEDIA_UPLOAD_NOT_FOUND", "上传会话不存在。", 404);
      }
      if (current.upload.status === "completed") {
        return current.media;
      }
      if (current.upload.status !== "pending" || current.media.status !== "uploading") {
        throw new ApiError("MEDIA_UPLOAD_NOT_FOUND", "上传会话不可用。", 404);
      }
      if (current.upload.expiresAt < now) {
        throw new ApiError("MEDIA_UPLOAD_EXPIRED", "上传会话已过期。", 422);
      }

      const [updatedMedia] = await tx
        .update(mediaObjects)
        .set({
          status: "active",
          byteSize: storedByteSize,
          mimeType: storedMimeType,
          fileName: storedFileName,
          deletedAt: null,
          purgedAt: null,
          updatedBy: auth.userId,
          updatedAt: now,
        })
        .where(
          and(
            eq(mediaObjects.id, current.media.id),
            eq(mediaObjects.tenantId, auth.tenantId),
            eq(mediaObjects.status, "uploading"),
          ),
        )
        .returning();
      if (!updatedMedia) {
        throw new ApiError("MEDIA_NOT_FOUND", "媒体对象不存在。", 404);
      }

      if (payload.usage) {
        await upsertMediaUsageWithClient(tx, {
          tenantId: auth.tenantId,
          mediaId: updatedMedia.id,
          resourceType: payload.usage.resourceType,
          resourceId: payload.usage.resourceId,
          usageKind: payload.usage.usageKind,
          userId: auth.userId,
          now,
        });
      }

      if (updatedMedia.purpose === "avatar") {
        await tx.execute(sql`select id from users where id = ${auth.userId} for update`);
        const [currentUser] = await tx
          .select({ avatarMediaId: users.avatarMediaId })
          .from(users)
          .where(and(eq(users.id, auth.userId), eq(users.tenantId, auth.tenantId)))
          .limit(1);
        if (!currentUser) {
          throw new ApiError("USER_NOT_FOUND", "用户不存在。", 404);
        }
        await upsertMediaUsageWithClient(tx, {
          tenantId: auth.tenantId,
          mediaId: updatedMedia.id,
          resourceType: "user",
          resourceId: auth.userId,
          usageKind: "avatar",
          userId: auth.userId,
          now,
        });
        await tx
          .update(users)
          .set({ avatarMediaId: updatedMedia.id, updatedBy: auth.userId, updatedAt: now })
          .where(and(eq(users.id, auth.userId), eq(users.tenantId, auth.tenantId)));
        if (currentUser.avatarMediaId && currentUser.avatarMediaId !== updatedMedia.id) {
          await this.releaseAvatarMedia(tx, auth, currentUser.avatarMediaId, now);
        }
      }

      const [completedUpload] = await tx
        .update(mediaUploads)
        .set({
          status: "completed",
          completedAt: now,
          deletedAt: null,
          updatedBy: auth.userId,
          updatedAt: now,
        })
        .where(
          and(
            eq(mediaUploads.id, current.upload.id),
            eq(mediaUploads.status, "pending"),
            eq(mediaUploads.createdBy, auth.userId),
          ),
        )
        .returning({ id: mediaUploads.id });
      if (!completedUpload) {
        throw new ApiError("MEDIA_UPLOAD_NOT_FOUND", "上传会话不可用。", 404);
      }
      return updatedMedia;
    });

    return serializeMediaObject(media);
  }

  async removeAvatar(auth: AuthContext) {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from users where id = ${auth.userId} for update`);
      const [currentUser] = await tx
        .select({ avatarMediaId: users.avatarMediaId })
        .from(users)
        .where(and(eq(users.id, auth.userId), eq(users.tenantId, auth.tenantId)))
        .limit(1);
      if (!currentUser) {
        throw new ApiError("USER_NOT_FOUND", "用户不存在。", 404);
      }
      await tx
        .update(users)
        .set({ avatarMediaId: null, updatedBy: auth.userId, updatedAt: now })
        .where(and(eq(users.id, auth.userId), eq(users.tenantId, auth.tenantId)));
      if (currentUser.avatarMediaId) {
        await this.releaseAvatarMedia(tx, auth, currentUser.avatarMediaId, now);
      }
      return { avatarMediaId: null };
    });
  }

  async getAvatarSource(auth: AuthContext, userId: string) {
    const [user] = await this.db
      .select({ id: users.id, avatarMediaId: users.avatarMediaId })
      .from(users)
      .where(
        and(
          eq(users.id, userId),
          eq(users.tenantId, auth.tenantId),
          eq(users.status, "active"),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    if (!user) {
      throw new ApiError("USER_NOT_FOUND", "用户不存在。", 404);
    }
    if (user.avatarMediaId) {
      const [media] = await this.db
        .select({ bucket: mediaObjects.bucket, objectKey: mediaObjects.objectKey })
        .from(mediaObjects)
        .where(
          and(
            eq(mediaObjects.id, user.avatarMediaId),
            eq(mediaObjects.tenantId, auth.tenantId),
            eq(mediaObjects.purpose, "avatar"),
            eq(mediaObjects.status, "active"),
            isNull(mediaObjects.deletedAt),
          ),
        )
        .limit(1);
      if (media) {
        return {
          kind: "uploaded" as const,
          url: await this.storage.createReadUrl(media.bucket, media.objectKey),
        };
      }
    }
    return { kind: "generated" as const, seed: user.id };
  }

  async getStorageSummary(auth: AuthContext): Promise<StorageSummary> {
    const [tenant] = await this.db
      .select({ quotaBytes: tenants.storageQuotaBytes })
      .from(tenants)
      .where(eq(tenants.id, auth.tenantId))
      .limit(1);
    if (!tenant) {
      throw new ApiError("TENANT_NOT_FOUND", "当前空间不存在。", 404);
    }
    const rows = await this.db
      .select({
        status: mediaObjects.status,
        purpose: mediaObjects.purpose,
        bytes: sql<number>`coalesce(sum(${mediaObjects.byteSize}), 0)`,
      })
      .from(mediaObjects)
      .where(
        and(
          eq(mediaObjects.tenantId, auth.tenantId),
          inArray(mediaObjects.status, countedMediaStatuses),
        ),
      )
      .groupBy(mediaObjects.status, mediaObjects.purpose);

    const breakdown: Record<MediaPurpose, number> = { avatar: 0, inline: 0, attachment: 0, cover: 0 };
    let usedBytes = 0;
    let reservedBytes = 0;
    let reclaimingBytes = 0;
    for (const row of rows) {
      const bytes = Number(row.bytes);
      if (row.status === "active") {
        usedBytes += bytes;
        breakdown[row.purpose as MediaPurpose] += bytes;
      } else if (row.status === "uploading") {
        reservedBytes += bytes;
      } else {
        reclaimingBytes += bytes;
      }
    }
    return {
      quotaBytes: tenant.quotaBytes,
      usedBytes,
      reservedBytes,
      reclaimingBytes,
      availableBytes: Math.max(tenant.quotaBytes - usedBytes - reservedBytes - reclaimingBytes, 0),
      breakdown,
    };
  }

  getMediaLimits() {
    return { avatarMaxBytes: this.env.MEDIA_AVATAR_MAX_BYTES };
  }

  async createReadUrl(auth: AuthContext, mediaId: string) {
    const [media] = await this.db
      .select()
      .from(mediaObjects)
      .where(
        and(
          eq(mediaObjects.id, mediaId),
          eq(mediaObjects.tenantId, auth.tenantId),
          eq(mediaObjects.status, "active"),
          isNull(mediaObjects.deletedAt),
        ),
      )
      .limit(1);
    if (!media) {
      throw new ApiError("MEDIA_NOT_FOUND", "媒体对象不存在或不可访问。", 404);
    }
    return { url: await this.storage.createReadUrl(media.bucket, media.objectKey) };
  }

  private async releaseAvatarMedia(
    tx: Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0],
    auth: AuthContext,
    mediaId: string,
    now: Date,
  ) {
    await tx.execute(sql`select id from media_objects where id = ${mediaId} for update`);
    await tx
      .update(mediaUsages)
      .set({ deletedAt: now, updatedBy: auth.userId, updatedAt: now })
      .where(
        and(
          eq(mediaUsages.tenantId, auth.tenantId),
          eq(mediaUsages.mediaId, mediaId),
          eq(mediaUsages.resourceType, "user"),
          eq(mediaUsages.resourceId, auth.userId),
          eq(mediaUsages.usageKind, "avatar"),
          isNull(mediaUsages.deletedAt),
        ),
      );
    const [remainingUsage] = await tx
      .select({ id: mediaUsages.id })
      .from(mediaUsages)
      .where(and(eq(mediaUsages.mediaId, mediaId), isNull(mediaUsages.deletedAt)))
      .limit(1);
    if (remainingUsage) return;

    const [pendingMedia] = await tx
      .update(mediaObjects)
      .set({ status: "pending_delete", deletedAt: now, updatedBy: auth.userId, updatedAt: now })
      .where(
        and(
          eq(mediaObjects.id, mediaId),
          eq(mediaObjects.tenantId, auth.tenantId),
          eq(mediaObjects.purpose, "avatar"),
          eq(mediaObjects.status, "active"),
        ),
      )
      .returning({ id: mediaObjects.id });
    if (!pendingMedia) return;

    await tx
      .insert(mediaDeletionJobs)
      .values({
        tenantId: auth.tenantId,
        mediaId,
        status: "pending",
        attempts: 0,
        nextAttemptAt: now,
        createdBy: auth.userId,
        updatedBy: auth.userId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: mediaDeletionJobs.mediaId,
        set: {
          status: "pending",
          attempts: 0,
          nextAttemptAt: now,
          lastError: null,
          completedAt: null,
          updatedBy: auth.userId,
          updatedAt: now,
        },
      });
  }

  private async ensureDocumentUsageTarget(auth: AuthContext, documentId: string) {
    const [document] = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.tenantId, auth.tenantId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    if (!document) {
      throw new ApiError("DOCUMENT_NOT_FOUND", "文档不存在。", 404);
    }
  }
}
