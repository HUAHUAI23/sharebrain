import type { MediaObject, MediaUploadResponse } from "@sharebrain/contracts";
import type { EditorUploadHandler } from "@sharebrain/editor";

import { apiRequest } from "../../lib/api-client";
import { runtimeEnv } from "../../lib/runtime-env";

const FALLBACK_MIME_TYPE = "application/octet-stream";

function postToStorage(
  upload: MediaUploadResponse,
  file: File,
  mimeType: string,
  options: { onProgress: (progress: number) => void; signal: AbortSignal },
) {
  return new Promise<void>((resolve, reject) => {
    const form = new FormData();

    for (const [key, value] of Object.entries(upload.fields)) {
      form.append(key, value);
    }

    form.append("file", new File([file], file.name, { type: mimeType }));

    const xhr = new XMLHttpRequest();

    xhr.open("POST", upload.url);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        options.onProgress((event.loaded / event.total) * 100);
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`媒体存储上传失败（HTTP ${xhr.status}）。`));
      }
    });
    xhr.addEventListener("error", () => {
      reject(new Error("媒体存储上传失败。"));
    });
    xhr.addEventListener("abort", () => {
      reject(new DOMException("Upload aborted", "AbortError"));
    });
    options.signal.addEventListener("abort", () => {
      xhr.abort();
    });

    xhr.send(form);
  });
}

/**
 * 编辑器媒体上传：走 /api/media 的预签名直传链路
 * （创建会话 → 直传对象存储 → 确认完成 → 换取读取地址）。
 */
export function createEditorUploadHandler(options: {
  documentId: string;
}): EditorUploadHandler {
  return async (file, { onProgress, signal }) => {
    const mimeType = file.type || FALLBACK_MIME_TYPE;

    const upload = await apiRequest<MediaUploadResponse>("/api/media/uploads", {
      method: "POST",
      body: {
        fileName: file.name,
        mimeType,
        byteSize: file.size,
        usageKind: "inline",
      },
    });

    await postToStorage(upload, file, mimeType, {
      onProgress: (progress) => onProgress({ progress }),
      signal,
    });

    await apiRequest<MediaObject>(`/api/media/uploads/${upload.uploadId}/complete`, {
      method: "POST",
      body: {
        byteSize: file.size,
        mimeType,
        usage: {
          resourceType: "document",
          resourceId: options.documentId,
          usageKind: "inline",
        },
      },
    });

    return {
      key: upload.mediaId,
      name: file.name,
      size: file.size,
      type: mimeType,
      // 预签名读取 URL 会过期，文档里必须落稳定地址，由 API 按需 302 到新签名。
      url: `${runtimeEnv.WEB_PUBLIC_API_BASE_URL}/api/media/${upload.mediaId}/raw`,
    };
  };
}
