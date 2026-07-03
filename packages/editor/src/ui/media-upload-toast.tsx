import * as React from 'react';

import { PlaceholderPlugin, UploadErrorCode } from '@platejs/media/react';
import { usePluginOption } from 'platejs/react';
import { toast } from 'sonner';

import { m } from '@sharebrain/i18n';

export function MediaUploadToast() {
  useUploadErrorToast();

  return null;
}

const useUploadErrorToast = () => {
  const uploadError = usePluginOption(PlaceholderPlugin, 'error');

  React.useEffect(() => {
    if (!uploadError) return;

    const { code, data } = uploadError;

    switch (code) {
      case UploadErrorCode.INVALID_FILE_SIZE: {
        toast.error(
          m.editor_upload_error_invalid_size({
            files: data.files.map((f) => f.name).join(', '),
          })
        );

        break;
      }
      case UploadErrorCode.INVALID_FILE_TYPE: {
        toast.error(
          m.editor_upload_error_invalid_type({
            files: data.files.map((f) => f.name).join(', '),
          })
        );

        break;
      }
      case UploadErrorCode.TOO_LARGE: {
        toast.error(
          m.editor_upload_error_too_large({
            files: data.files.map((f) => f.name).join(', '),
            maxFileSize: data.maxFileSize,
          })
        );

        break;
      }
      case UploadErrorCode.TOO_LESS_FILES: {
        toast.error(
          m.editor_upload_error_too_few({
            fileType: data.fileType ?? '',
            minFileCount: String(data.minFileCount),
          })
        );

        break;
      }
      case UploadErrorCode.TOO_MANY_FILES: {
        toast.error(
          m.editor_upload_error_too_many({
            fileType: data.fileType ?? '',
            maxFileCount: String(data.maxFileCount),
          })
        );

        break;
      }
    }
  }, [uploadError]);
};
