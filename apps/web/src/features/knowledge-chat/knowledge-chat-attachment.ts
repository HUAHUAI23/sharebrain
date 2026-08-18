// 复用私有媒体上传协议，把聊天附件物化为可在消息 part 中引用的 mediaObjectId。
import type { MediaObject, MediaUploadResponse } from "@sharebrain/contracts";

import { apiRequest } from "../../lib/api-client";

function postToStorage(
  upload: MediaUploadResponse,
  file: File,
  onProgress: (progress: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
    form.append("file", file);
    const request = new XMLHttpRequest();
    request.open("POST", upload.url);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`Attachment upload failed (${request.status})`));
    });
    request.addEventListener("error", () => reject(new Error("Attachment upload failed")));
    request.send(form);
  });
}

export async function uploadKnowledgeChatAttachment(
  file: File,
  onProgress: (progress: number) => void,
) {
  const mimeType = file.type || "application/octet-stream";
  const upload = await apiRequest<MediaUploadResponse>("/api/media/uploads", {
    method: "POST",
    body: {
      fileName: file.name,
      mimeType,
      byteSize: file.size,
      usageKind: "attachment",
    },
  });
  await postToStorage(upload, file, onProgress);
  return apiRequest<MediaObject>(`/api/media/uploads/${upload.uploadId}/complete`, {
    method: "POST",
    body: { byteSize: file.size, mimeType },
  });
}
