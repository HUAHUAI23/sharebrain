import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { ServerEnv } from "@sharebrain/config";

import { ApiError } from "../../app/api-error";

export class StorageService {
  private readonly client: S3Client;

  constructor(private readonly env: ServerEnv) {
    const config = {
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    };

    this.client = new S3Client({
      ...config,
      endpoint: env.S3_ENDPOINT,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  async createPostPolicy(params: {
    key: string;
    mimeType: string;
    maxBytes: number;
    expiresSeconds: number;
  }) {
    try {
      return await createPresignedPost(this.client, {
        Bucket: this.env.S3_BUCKET,
        Key: params.key,
        Conditions: [
          ["content-length-range", 1, params.maxBytes],
          ["eq", "$Content-Type", params.mimeType],
        ],
        Fields: {
          "Content-Type": params.mimeType,
        },
        Expires: params.expiresSeconds,
      });
    } catch (error) {
      throw new ApiError("MEDIA_UPLOAD_POLICY_FAILED", "媒体上传签名配置不可用。", 500, {
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  async createReadUrl(bucket: string, key: string) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
      { expiresIn: this.env.MEDIA_READ_URL_EXPIRES_SECONDS },
    );
  }

  async headObject(bucket: string, key: string) {
    return this.client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
  }

  async getObjectBytes(bucket: string, key: string) {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
    if (!response.Body) {
      throw new ApiError("MEDIA_OBJECT_EMPTY", "媒体对象内容为空。", 422);
    }
    return response.Body.transformToByteArray();
  }

  async putObject(params: { bucket: string; key: string; body: Uint8Array; mimeType: string; cacheControl?: string }) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: params.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.mimeType,
        CacheControl: params.cacheControl,
      }),
    );
  }

}
