import {
  completeMediaUploadRequestSchema,
  createMediaUploadRequestSchema,
  type AuthContext,
} from "@sharebrain/contracts";
import { mediaObjects, mediaUploads, mediaUsages, users } from "@sharebrain/db/schema";
import { and, eq, isNull } from "drizzle-orm";

import { ApiError } from "../../app/api-error";
import { parseJson } from "../../app/validation";
import { serializeMediaObject } from "../shared/serializers";
import { StorageService } from "./storage.service";

import type { ServerEnv } from "@sharebrain/config";
import type { DatabaseClient } from "@sharebrain/db";

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
}

export class MediaService {
  private readonly storage: StorageService;

  constructor(
    private readonly db: DatabaseClient,
    env: ServerEnv,
  ) {
    this.storage = new StorageService(env);
    this.env = env;
  }

  private readonly env: ServerEnv;

  async createUpload(auth: AuthContext, input: unknown) {
    const payload = parseJson(createMediaUploadRequestSchema, input);
    if (payload.byteSize > this.env.MEDIA_UPLOAD_MAX_BYTES) {
      throw new ApiError("MEDIA_TOO_LARGE", "文件超过允许大小。", 422, {
        maxBytes: this.env.MEDIA_UPLOAD_MAX_BYTES,
      });
    }

    const now = new Date();
    const mediaId = crypto.randomUUID();
    const safeName = sanitizeFileName(payload.fileName);
    const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const objectKey = `tenants/${auth.tenantId}/media/${month}/${mediaId}/${safeName}`;

    const policy = await this.storage.createPostPolicy({
      key: objectKey,
      mimeType: payload.mimeType,
      maxBytes: Math.min(payload.byteSize, this.env.MEDIA_UPLOAD_MAX_BYTES),
      expiresSeconds: this.env.MEDIA_UPLOAD_EXPIRES_SECONDS,
    });

    const expiresAt = new Date(now.getTime() + this.env.MEDIA_UPLOAD_EXPIRES_SECONDS * 1000);
    const [media] = await this.db
      .insert(mediaObjects)
      .values({
        id: mediaId,
        tenantId: auth.tenantId,
        bucket: this.env.S3_BUCKET,
        objectKey,
        fileName: payload.fileName,
        mimeType: payload.mimeType,
        byteSize: payload.byteSize,
        status: "uploading",
        metadata: { usageKind: payload.usageKind },
        createdBy: auth.userId,
        updatedBy: auth.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!media) {
      throw new ApiError("MEDIA_CREATE_FAILED", "媒体对象创建失败。", 500);
    }

    const [upload] = await this.db
      .insert(mediaUploads)
      .values({
        tenantId: auth.tenantId,
        mediaId: media.id,
        status: "pending",
        uploadUrl: policy.url,
        policyFields: policy.fields,
        maxBytes: Math.min(payload.byteSize, this.env.MEDIA_UPLOAD_MAX_BYTES),
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

    return {
      uploadId: upload.id,
      mediaId: media.id,
      url: policy.url,
      fields: policy.fields,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async completeUpload(auth: AuthContext, uploadId: string, input: unknown) {
    const payload = parseJson(completeMediaUploadRequestSchema, input);
    const [upload] = await this.db
      .select({ upload: mediaUploads, media: mediaObjects })
      .from(mediaUploads)
      .innerJoin(mediaObjects, eq(mediaUploads.mediaId, mediaObjects.id))
      .where(and(eq(mediaUploads.id, uploadId), eq(mediaUploads.tenantId, auth.tenantId), isNull(mediaUploads.deletedAt)))
      .limit(1);

    if (!upload) {
      throw new ApiError("MEDIA_UPLOAD_NOT_FOUND", "上传会话不存在。", 404);
    }

    if (upload.upload.expiresAt < new Date()) {
      throw new ApiError("MEDIA_UPLOAD_EXPIRED", "上传会话已过期。", 422);
    }

    if (payload.byteSize > upload.upload.maxBytes || payload.mimeType !== upload.upload.expectedMimeType) {
      throw new ApiError("MEDIA_UPLOAD_MISMATCH", "上传文件与会话限制不匹配。", 422);
    }

    try {
      const head = await this.storage.headObject(upload.media.objectKey);
      if (head.ContentLength && head.ContentLength !== payload.byteSize) {
        throw new ApiError("MEDIA_UPLOAD_SIZE_MISMATCH", "对象大小校验失败。", 422);
      }
      if (head.ContentType && head.ContentType !== payload.mimeType) {
        throw new ApiError("MEDIA_UPLOAD_TYPE_MISMATCH", "对象类型校验失败。", 422);
      }
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError("MEDIA_OBJECT_UNAVAILABLE", "无法确认对象已上传。", 422);
    }

    const now = new Date();
    const [media] = await this.db
      .update(mediaObjects)
      .set({
        status: "active",
        byteSize: payload.byteSize,
        mimeType: payload.mimeType,
        updatedBy: auth.userId,
        updatedAt: now,
      })
      .where(eq(mediaObjects.id, upload.media.id))
      .returning();

    await this.db
      .update(mediaUploads)
      .set({
        status: "completed",
        completedAt: now,
        updatedBy: auth.userId,
        updatedAt: now,
      })
      .where(eq(mediaUploads.id, upload.upload.id));

    if (!media) {
      throw new ApiError("MEDIA_NOT_FOUND", "媒体对象不存在。", 404);
    }

    return serializeMediaObject(media);
  }

  async createReadUrl(auth: AuthContext, mediaId: string) {
    const [media] = await this.db
      .select()
      .from(mediaObjects)
      .where(and(eq(mediaObjects.id, mediaId), eq(mediaObjects.tenantId, auth.tenantId), eq(mediaObjects.status, "active"), isNull(mediaObjects.deletedAt)))
      .limit(1);

    if (!media) {
      throw new ApiError("MEDIA_NOT_FOUND", "媒体对象不存在或不可访问。", 404);
    }

    return { url: await this.storage.createReadUrl(media.objectKey) };
  }

  async attachAvatar(auth: AuthContext, mediaId: string) {
    const now = new Date();
    await this.db.insert(mediaUsages).values({
      tenantId: auth.tenantId,
      mediaId,
      resourceType: "user",
      resourceId: auth.userId,
      usageKind: "avatar",
      metadata: {},
      createdBy: auth.userId,
      updatedBy: auth.userId,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [mediaUsages.mediaId, mediaUsages.resourceType, mediaUsages.resourceId, mediaUsages.usageKind],
      set: {
        updatedBy: auth.userId,
        updatedAt: now,
      },
    });

    const [user] = await this.db
      .update(users)
      .set({ avatarMediaId: mediaId, updatedBy: auth.userId, updatedAt: now })
      .where(and(eq(users.id, auth.userId), eq(users.tenantId, auth.tenantId)))
      .returning();

    if (!user) {
      throw new ApiError("USER_NOT_FOUND", "用户不存在。", 404);
    }

    return { avatarMediaId: mediaId };
  }
}
