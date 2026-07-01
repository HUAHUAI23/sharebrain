import { m } from "@sharebrain/i18n";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImageUp } from "lucide-react";

import { apiRequest, queryKeys } from "../../lib/api-client";

type UploadResponse = {
  uploadId: string;
  mediaId: string;
  url: string;
  fields: Record<string, string>;
};

export function AvatarUpload() {
  const queryClient = useQueryClient();
  const upload = useMutation({
    async mutationFn(file: File) {
      const session = await apiRequest<UploadResponse>("/api/media/uploads", {
        method: "POST",
        body: {
          fileName: file.name,
          mimeType: file.type,
          byteSize: file.size,
          usageKind: "avatar",
        },
      });

      const formData = new FormData();
      for (const [key, value] of Object.entries(session.fields)) {
        formData.append(key, value);
      }
      formData.append("file", file);
      const uploadResponse = await fetch(session.url, {
        method: "POST",
        body: formData,
      });
      if (!uploadResponse.ok) {
        throw new Error(m.media_avatar_upload_failed());
      }

      await apiRequest(`/api/media/uploads/${session.uploadId}/complete`, {
        method: "POST",
        body: {
          byteSize: file.size,
          mimeType: file.type,
        },
      });
      await apiRequest("/api/me/avatar", {
        method: "PATCH",
        body: { mediaId: session.mediaId },
      });
    },
    async onSuccess() {
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });

  return (
    <label className="avatar-upload">
      <input
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            upload.mutate(file);
          }
        }}
      />
      <span
        className={
          upload.isPending
            ? "inline-flex min-h-7 cursor-default items-center justify-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground opacity-55"
            : "inline-flex min-h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent"
        }
      >
        <ImageUp size={14} />
        <span>{upload.isPending ? m.media_uploading() : m.media_avatar()}</span>
      </span>
    </label>
  );
}
