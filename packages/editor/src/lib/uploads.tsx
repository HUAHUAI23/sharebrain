import * as React from 'react';

export type UploadedEditorFile = {
  /** Public URL of the uploaded file. */
  url: string;
  name: string;
  size: number;
  type: string;
  /** Optional storage key returned by the backend. */
  key?: string;
};

export type EditorUploadProgress = {
  /** Upload progress in the 0-100 range. */
  progress: number;
};

export type EditorUploadHandler = (
  file: File,
  options: {
    onProgress: (event: EditorUploadProgress) => void;
    signal: AbortSignal;
  }
) => Promise<UploadedEditorFile>;

export type EditorUploadErrorHandler = (error: unknown, file: File) => void;

type EditorUploadContextValue = {
  onError?: EditorUploadErrorHandler | undefined;
  uploadFile?: EditorUploadHandler | undefined;
};

const EditorUploadContext = React.createContext<EditorUploadContextValue>({});

/**
 * Injects the host application's file upload implementation into the editor.
 * Without a provider (or without `uploadFile`), uploads fall back to local
 * object URLs so media keeps working in demos and offline scenarios — those
 * URLs only live for the current browser session.
 */
export function EditorUploadProvider({
  children,
  onError,
  uploadFile,
}: React.PropsWithChildren<EditorUploadContextValue>) {
  const value = React.useMemo(
    () => ({ onError, uploadFile }),
    [onError, uploadFile]
  );

  return (
    <EditorUploadContext.Provider value={value}>
      {children}
    </EditorUploadContext.Provider>
  );
}

const createLocalFallbackUpload = (file: File): UploadedEditorFile => ({
  name: file.name,
  size: file.size,
  type: file.type,
  url: URL.createObjectURL(file),
});

export function useUploadFile() {
  const { onError, uploadFile: handler } = React.useContext(EditorUploadContext);

  const [uploadedFile, setUploadedFile] = React.useState<UploadedEditorFile>();
  const [uploadingFile, setUploadingFile] = React.useState<File>();
  const [progress, setProgress] = React.useState(0);
  const [isUploading, setIsUploading] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  const uploadFile = React.useCallback(
    async (file: File) => {
      setIsUploading(true);
      setUploadingFile(file);
      setProgress(0);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = handler
          ? await handler(file, {
              onProgress: ({ progress }) => {
                setProgress(Math.min(progress, 100));
              },
              signal: controller.signal,
            })
          : createLocalFallbackUpload(file);

        setProgress(100);
        setUploadedFile(result);

        return result;
      } catch (error) {
        onError?.(error, file);

        // Fall back to a session-local object URL so the placeholder block
        // still resolves instead of being stuck in the uploading state.
        const fallback = createLocalFallbackUpload(file);

        setProgress(100);
        setUploadedFile(fallback);

        return fallback;
      } finally {
        setIsUploading(false);
        setUploadingFile(undefined);
      }
    },
    [handler, onError]
  );

  return {
    isUploading,
    progress,
    uploadedFile,
    uploadFile,
    uploadingFile,
  };
}
