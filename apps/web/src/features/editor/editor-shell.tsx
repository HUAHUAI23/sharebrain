import { MarkdownPlugin } from "@platejs/markdown";
import { YjsPlugin } from "@platejs/yjs/react";
import {
  CommentsPopoverButton,
  discussionPlugin,
  Editor,
  EditorContainer,
  EditorKit,
  EditorMoreMenu,
  EditorUploadProvider,
  RemoteCursorOverlay,
} from "@sharebrain/editor";
import { m } from "@sharebrain/i18n";
import { Button } from "@sharebrain/ui/components/button";
import { Input } from "@sharebrain/ui/components/input";
import { NotionEmpty, NotionToolbar } from "@sharebrain/ui/components/notion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText } from "lucide-react";
import type { Value } from "platejs";
import { Plate, usePlateEditor } from "platejs/react";
import { useEffect, useRef, useState } from "react";

import { apiRequest, queryKeys } from "../../lib/api-client";
import { runtimeEnv } from "../../lib/runtime-env";
import { uploadEditorFile } from "./editor-upload";
import type { DocumentResponse, MeResponse, WorkspaceView } from "../workspace/workspace-types";

const emptyPlateValue: Value = [{ type: "p", children: [{ text: "" }] }];

const cursorColors = [
  "#2f76d2",
  "#6b8e23",
  "#b07d2b",
  "#8a63d2",
  "#c4554d",
  "#0e7f74",
  "#b0529d",
];

function cursorColorForUser(userId: string) {
  let hash = 0;

  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 31 + userId.charCodeAt(index)) >>> 0;
  }

  return cursorColors[hash % cursorColors.length]!;
}

function toPlateValue(value: unknown): Value {
  if (!Array.isArray(value)) {
    return emptyPlateValue;
  }

  const elements = value.filter(
    (node): node is Value[number] =>
      Boolean(node) &&
      typeof node === "object" &&
      "children" in node &&
      Array.isArray((node as { children?: unknown }).children),
  );

  return elements.length > 0 ? elements : emptyPlateValue;
}

type EditorShellProps = {
  projectId: string;
  moduleId: string;
  documentId: string;
  recordId?: string;
  onNavigate: (view: WorkspaceView) => void;
};

export function EditorShell({ projectId, moduleId, documentId, recordId, onNavigate }: EditorShellProps) {
  const me = useQuery({
    queryKey: queryKeys.me,
    queryFn: () => apiRequest<MeResponse>("/api/me"),
  });
  const document = useQuery({
    queryKey: queryKeys.document(documentId),
    queryFn: () => apiRequest<DocumentResponse>(`/api/documents/${documentId}`),
    // 内容事实源由协作服务落库，编辑期间不要用旧版本覆盖编辑器。
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });

  if (!me.data || !document.data) {
    return (
      <main className="editor-page">
        <NotionEmpty>{m.common_loading_document()}</NotionEmpty>
      </main>
    );
  }

  return (
    <DocumentEditor
      key={documentId}
      projectId={projectId}
      moduleId={moduleId}
      documentId={documentId}
      {...(recordId ? { recordId } : {})}
      user={me.data.user}
      initialDocument={document.data}
      onNavigate={onNavigate}
    />
  );
}

type DocumentEditorProps = {
  projectId: string;
  moduleId: string;
  documentId: string;
  recordId?: string;
  user: MeResponse["user"];
  initialDocument: DocumentResponse;
  onNavigate: (view: WorkspaceView) => void;
};

function DocumentEditor({
  projectId,
  moduleId,
  documentId,
  recordId,
  user,
  initialDocument,
  onNavigate,
}: DocumentEditorProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(initialDocument.title);
  const savedTitleRef = useRef(initialDocument.title);

  const editor = usePlateEditor({
    plugins: [
      ...EditorKit,
      YjsPlugin.configure({
        options: {
          cursors: {
            data: {
              color: cursorColorForUser(user.id),
              name: user.displayName,
            },
          },
          providers: [
            {
              type: "hocuspocus",
              options: {
                name: `document:${documentId}`,
                url: runtimeEnv.WEB_PUBLIC_COLLAB_WS_URL,
                token: user.id,
              },
            },
          ],
        },
        render: {
          afterEditable: RemoteCursorOverlay,
        },
      }),
    ],
    skipInitialization: true,
  });

  // PlateContent 在 children 为空时不挂载（也就不会订阅 store 更新），
  // 先塞一个占位空段落让编辑器立即渲染；yjs.init 连接后由 ydoc 内容覆盖。
  if (editor.children.length === 0) {
    editor.children = [{ type: "p", children: [{ text: "" }] }];
  }

  useEffect(() => {
    editor.setOption(discussionPlugin, "currentUserId", user.id);
    editor.setOption(discussionPlugin, "users", {
      [user.id]: { id: user.id, name: user.displayName },
    });
  }, [editor, user.id, user.displayName]);

  useEffect(() => {
    let initialValue = toPlateValue(initialDocument.plateJson);

    if (initialValue === emptyPlateValue && initialDocument.markdown) {
      initialValue = toPlateValue(
        editor.getApi(MarkdownPlugin).markdown.deserialize(initialDocument.markdown),
      );
    }

    const yjs = editor.getApi(YjsPlugin).yjs;
    // StrictMode 会立即执行一次 mount/cleanup 再正式挂载；yjs.init 是异步长流程
    // （等 provider sync），并发的两次 init 会互相打断。用宏任务延迟一拍，
    // 让被 StrictMode 立刻清理的首次 effect 不真正发起 init。
    let active = true;
    let started = false;
    const timer = setTimeout(() => {
      if (!active) return;

      started = true;
      void Promise.resolve()
        .then(() =>
          yjs.init({
            id: `document:${documentId}`,
            autoSelect: "end",
            value: initialValue,
          }),
        )
        .catch((error: unknown) => {
          console.warn("collab init failed", error);
        });
    }, 0);

    return () => {
      active = false;
      clearTimeout(timer);

      if (!started) return;

      try {
        yjs.destroy();
      } catch (error) {
        console.warn("collab destroy failed", error);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, documentId]);

  const saveTitle = useMutation({
    mutationFn: (nextTitle: string) =>
      apiRequest(`/api/documents/${documentId}`, {
        method: "PATCH",
        body: { title: nextTitle },
      }),
    async onSuccess(_, nextTitle) {
      savedTitleRef.current = nextTitle;
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents(projectId, moduleId, recordId) });
    },
  });

  useEffect(() => {
    const nextTitle = title.trim();

    if (!nextTitle || nextTitle === savedTitleRef.current) {
      return;
    }

    const timer = setTimeout(() => {
      saveTitle.mutate(nextTitle);
    }, 600);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  return (
    <main className="editor-page">
      <EditorUploadProvider
        uploadFile={uploadEditorFile}
        onError={(error) => {
          console.error("editor media upload failed", error);
        }}
      >
        <Plate editor={editor}>
        <NotionToolbar className="grid grid-cols-[auto_auto_1fr_auto]">
          <Button
            variant="ghost"
            size="icon"
            aria-label={m.common_back_project()}
            onClick={() =>
              onNavigate({
                type: "project",
                projectId,
                moduleId,
                ...(recordId ? { recordId } : {}),
              })
            }
          >
            <ArrowLeft size={16} />
          </Button>
          <FileText size={16} />
          <span>{title || m.common_untitled()}</span>
          <span className="flex items-center justify-end gap-1">
            <CommentsPopoverButton />
            <EditorMoreMenu fileName={title || "document"} />
          </span>
        </NotionToolbar>
        <article className="markdown-editor">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-label={m.module_document_title_aria()}
            className="title-input"
          />
          <EditorContainer className="min-h-[70vh]">
            <Editor
              variant="fullWidth"
              className="px-16 pt-1 pb-40 max-sm:px-6"
              placeholder={m.document_editor_placeholder()}
            />
          </EditorContainer>
        </article>
        </Plate>
      </EditorUploadProvider>
    </main>
  );
}
