// 附件展示：图片直接出缩略图，其余类型退回文件名条目。
import { isImageAttachment } from "@sharebrain/contracts";
import { m } from "@sharebrain/i18n";
import { File } from "lucide-react";
import { memo } from "react";

import { runtimeEnv } from "../../lib/runtime-env";

export type ChatAttachmentView = {
  mediaObjectId: string | null;
  fileName: string;
  mimeType: string;
};

function rawUrl(mediaObjectId: string) {
  return `${runtimeEnv.WEB_PUBLIC_API_BASE_URL}/api/media/${mediaObjectId}/raw`;
}

export const ChatAttachmentList = memo(function ChatAttachmentList({
  attachments,
}: {
  attachments: ChatAttachmentView[];
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="grid gap-1.5">
      {attachments.map((attachment, index) => {
        const href = attachment.mediaObjectId ? rawUrl(attachment.mediaObjectId) : undefined;
        if (isImageAttachment(attachment.mimeType) && href) {
          return (
            <a
              className="block min-w-0 overflow-hidden rounded-sm border border-border"
              href={href}
              key={attachment.mediaObjectId ?? index}
              target="_blank"
              rel="noreferrer"
            >
              <img
                className="max-h-56 w-full object-contain"
                src={href}
                alt={attachment.fileName || m.chat_attachment_image()}
                loading="lazy"
                decoding="async"
              />
            </a>
          );
        }
        return (
          <a
            className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            href={href}
            key={attachment.mediaObjectId ?? index}
            target="_blank"
            rel="noreferrer"
          >
            <File className="size-3.5 shrink-0" />
            <span className="truncate">{attachment.fileName}</span>
          </a>
        );
      })}
    </div>
  );
});
