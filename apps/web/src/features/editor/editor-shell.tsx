// 组合文档元数据、Plate/Yjs 协作和历史面板，并配置长文档渲染预算。
import { YjsPlugin } from "@platejs/yjs/react";
import {
  CommentsPopoverButton,
  EditableChunkFallback,
  EditableChunkWindow,
  EditableChunkWindowProvider,
  cloneEditorVersionValue,
  discussionPlugin,
  Editor,
  EditorContainer,
  EditorKit,
  EditorMoreMenu,
  EditorTocSidebar,
  EditorUploadProvider,
  EditorWindowFind,
  getEditableChunkDescriptor,
  getEditableChunkRange,
  getEditorWordClipboardPayload,
  installSafeEditorNodeLookup,
  parseEditorWordClipboard,
  RemoteCursorOverlay,
  SuggestionModeToggle,
  mergeDiscussionReadStates,
  setEditorDiscussionReadStates,
  type DiscussionReadItem,
  type TDiscussion,
  type TDiscussionReadState,
} from "@sharebrain/editor";
import {
  projectDocumentVersionValue,
  type DocumentDiscussionsResponse,
  type MarkDocumentDiscussionsReadResponse,
  type TenantMember,
} from "@sharebrain/contracts";
import { m } from "@sharebrain/i18n";
import { Button } from "@sharebrain/ui/components/button";
import { Input } from "@sharebrain/ui/components/input";
import { NotionEmpty, NotionToolbar } from "@sharebrain/ui/components/notion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { KEYS, type TElement, type Value } from "platejs";
import { Plate, usePlateEditor, type PlateChunkProps } from "platejs/react";
import { VersionPreview } from "@sharebrain/editor/ui/version-preview";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import * as Y from "yjs";

import { apiRequest, queryKeys } from "../../lib/api-client";
import { runtimeEnv } from "../../lib/runtime-env";
import { AccountMenu } from "../account/account-menu";
import { toEditorDiscussions, useEditorDiscussionsBridge } from "./editor-discussions";
import { createEditorUploadHandler } from "./editor-upload";
import { createEditorParticipantDirectory } from "./editor-participants";
import {
  DocumentHistoryButton,
  DocumentHistoryPanel,
  type DocumentHistoryTab,
} from "./document-activity-history";
import { DocumentActivityRevision } from "./document-activity-revision";
import { DocumentVersionHistory } from "./document-version-history";
import { CURRENT_DOCUMENT_VERSION_KEY } from "./document-version-history.state";
import {
  encodeDocumentStateVector,
  getEditorCollabProvider,
} from "./editor-collab-provider";
import { deferYjsEditorConnectionUntilInitialSync } from "./editor-yjs-bootstrap";
import type {
  DocumentMetadataResponse,
  DocumentPreviewResponse,
  MeResponse,
  WorkspaceView,
} from "../workspace/workspace-types";

const emptyPlateValue: Value = [{ type: "p", children: [{ text: "" }] }];
const emptyMembers: TenantMember[] = [];
const documentEditorChunkSize = 4;
const documentEditorOverscanPx = 700;

function DocumentEditorChunk({ attributes, children, lowest }: PlateChunkProps) {
  if (!lowest) return children;

  const descriptor = getEditableChunkDescriptor(children);

  if (descriptor) {
    return (
      <EditableChunkWindow attributes={attributes} descriptor={descriptor}>
        {children}
      </EditableChunkWindow>
    );
  }

  const range = getEditableChunkRange(children);

  return (
    <EditableChunkFallback attributes={attributes} range={range}>
      {children}
    </EditableChunkFallback>
  );
}

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

function toDocumentReadStates(readStates: TDiscussionReadState[]): DocumentDiscussionsResponse["readStates"] {
  return readStates.map((state) => ({
    activityKey: state.activityKey,
    discussionId: state.discussionId,
    readAt: state.readAt instanceof Date ? state.readAt.toISOString() : state.readAt,
  }));
}

function normalizeDocumentTitleInput(value: string) {
  return value.replace(/[\r\n]+/g, " ");
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
    queryKey: queryKeys.documentMetadata(documentId),
    queryFn: () =>
      apiRequest<DocumentMetadataResponse>(
        `/api/documents/${documentId}?includeContent=false`,
      ),
    // 内容事实源由协作服务落库，编辑期间不要用旧版本覆盖编辑器。
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
  const documentPreview = useQuery({
    queryKey: queryKeys.documentPreview(documentId),
    queryFn: () =>
      apiRequest<DocumentPreviewResponse>(
        `/api/documents/${documentId}?includeContent=preview`,
      ),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
  const discussions = useQuery({
    queryKey: queryKeys.documentDiscussions(documentId),
    queryFn: () => apiRequest<DocumentDiscussionsResponse>(`/api/documents/${documentId}/discussions`),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
  const members = useQuery({
    queryKey: queryKeys.members,
    queryFn: () => apiRequest<{ items: TenantMember[] }>("/api/members"),
    staleTime: 60_000,
  });
  const initialDiscussions = useMemo(
    () => toEditorDiscussions(discussions.data?.discussions ?? []),
    [discussions.data?.discussions],
  );
  const initialReadStates = useMemo(
    () => discussions.data?.readStates ?? [],
    [discussions.data?.readStates],
  );

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
      role={me.data.role}
      capabilities={me.data.capabilities}
      user={me.data.user}
      initialDocument={document.data}
      {...(documentPreview.data
        ? { initialPreview: documentPreview.data.plateJson }
        : {})}
      initialDiscussions={initialDiscussions}
      initialReadStates={initialReadStates}
      members={members.data?.items ?? emptyMembers}
      onNavigate={onNavigate}
    />
  );
}

type DocumentEditorProps = {
  projectId: string;
  moduleId: string;
  documentId: string;
  recordId?: string;
  role: MeResponse["role"];
  capabilities?: MeResponse["capabilities"];
  user: MeResponse["user"];
  initialDocument: DocumentMetadataResponse;
  initialPreview?: unknown[];
  initialDiscussions: TDiscussion[];
  initialReadStates: TDiscussionReadState[];
  members: TenantMember[];
  onNavigate: (view: WorkspaceView) => void;
};

function DocumentEditor({
  projectId,
  moduleId,
  documentId,
  recordId,
  role,
  capabilities,
  user,
  initialDocument,
  initialPreview,
  initialDiscussions,
  initialReadStates,
  members,
  onNavigate,
}: DocumentEditorProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(normalizeDocumentTitleInput(initialDocument.title));
  const initialPreviewValue = useMemo(
    () => (initialPreview ? toPlateValue(initialPreview) : null),
    [initialPreview],
  );
  const [editorReady, setEditorReady] = useState(false);
  const [historySnapshot, setHistorySnapshot] = useState<{
    selectedKey: string;
  } | null>(null);
  const [historyPanel, setHistoryPanel] = useState<{
    open: boolean;
    tab: DocumentHistoryTab;
  }>({
    open: false,
    tab: capabilities?.activityHistoryRead ? "activity" : "versions",
  });
  const [activityRevision, setActivityRevision] = useState<string | null>(null);
  const savedTitleRef = useRef(initialDocument.title);
  const collabBootstrapRef = useRef<ReturnType<
    typeof deferYjsEditorConnectionUntilInitialSync
  > | null>(null);
  const cachedCollabContentRef = useRef(false);
  const localCollabPersistenceReadyRef = useRef(false);
  const remoteCollabAuthenticatedRef = useRef(false);
  const uploadEditorFile = useMemo(() => createEditorUploadHandler({ documentId }), [documentId]);
  const participantDirectory = useMemo(
    () => createEditorParticipantDirectory(user, members),
    [members, user],
  );

  const editor = usePlateEditor({
    chunking: {
      chunkSize: documentEditorChunkSize,
      contentVisibilityAuto: false,
    },
    // Plate 的默认导航反馈会给每个 Slate element 注入 trackedEditor
    // selector。长文档普通输入会因此重算整棵元素树；本页面的 TOC 已自行滚动定位。
    navigationFeedback: false,
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
              type: "indexeddb",
              options: {
                docName: `sharebrain:${user.id}:document:${documentId}`,
              },
            },
            {
              type: "hocuspocus",
              options: {
                // provider 构造器不抢先连线，统一由 YjsPlugin.init 管理一次连接，
                // 避免 StrictMode/HMR 清理与内部自动连接竞争后进入重试退避。
                autoConnect: false,
                name: `document:${documentId}`,
                onAuthenticated: () => {
                  performance.mark("sharebrain:editor-yjs:authenticated:hocuspocus");
                  remoteCollabAuthenticatedRef.current = true;

                  if (
                    localCollabPersistenceReadyRef.current &&
                    cachedCollabContentRef.current
                  ) {
                    collabBootstrapRef.current?.connectFromCurrentState("cache");
                  }
                },
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
  installSafeEditorNodeLookup(editor);

  // PlateContent 在 children 为空时不挂载（也就不会订阅 store 更新），
  // 先塞一个占位空段落让编辑器立即渲染；yjs.init 连接后由 ydoc 内容覆盖。
  if (editor.children.length === 0) {
    editor.children = [{ type: "p", children: [{ text: "" }] }];
  }

  const documentDiscussionsQueryKey = queryKeys.documentDiscussions(documentId);
  const markDiscussionsRead = useMutation({
    mutationFn: (items: DiscussionReadItem[]) =>
      apiRequest<MarkDocumentDiscussionsReadResponse>(`/api/documents/${documentId}/discussions/read`, {
        method: "POST",
        body: { items },
      }),
    async onMutate(items) {
      await queryClient.cancelQueries({ queryKey: documentDiscussionsQueryKey });

      const previous =
        queryClient.getQueryData<DocumentDiscussionsResponse>(documentDiscussionsQueryKey);
      const optimisticReadStates = toDocumentReadStates(
        mergeDiscussionReadStates(previous?.readStates ?? initialReadStates, items),
      );

      queryClient.setQueryData<DocumentDiscussionsResponse>(
        documentDiscussionsQueryKey,
        (current) =>
          current
            ? {
                ...current,
                readStates: optimisticReadStates,
              }
            : current,
      );
      setEditorDiscussionReadStates(editor, optimisticReadStates);

      return { previous };
    },
    onError(_error, _items, context) {
      if (!context?.previous) return;

      queryClient.setQueryData<DocumentDiscussionsResponse>(
        documentDiscussionsQueryKey,
        context.previous,
      );
      setEditorDiscussionReadStates(editor, context.previous.readStates);
    },
    onSuccess(response) {
      queryClient.setQueryData<DocumentDiscussionsResponse>(
        documentDiscussionsQueryKey,
        (current) =>
          current
            ? {
                ...current,
                readStates: response.readStates,
              }
            : current,
      );
      setEditorDiscussionReadStates(editor, response.readStates);
    },
  });
  const markDiscussionsReadMutate = markDiscussionsRead.mutate;

  useEffect(() => {
    editor.setOption(discussionPlugin, "currentUserId", user.id);
    editor.setOption(discussionPlugin, "users", participantDirectory.discussionUsers);
    editor.setOption(discussionPlugin, "readStates", initialReadStates);
    editor.setOption(discussionPlugin, "canDeleteDiscussion", ({ currentUserId, discussion }) =>
      discussion.userId === currentUserId || role === "admin",
    );
    editor.setOption(discussionPlugin, "onDiscussionRead", (items) => {
      if (items.length === 0) return;
      markDiscussionsReadMutate(items);
    });

    return () => {
      editor.setOption(discussionPlugin, "canDeleteDiscussion", null);
      editor.setOption(discussionPlugin, "onDiscussionRead", null);
    };
  }, [editor, initialReadStates, markDiscussionsReadMutate, participantDirectory, role, user.id]);

  useEditorDiscussionsBridge(editor, initialDiscussions);

  useEffect(() => {
    const yjs = editor.getApi(YjsPlugin).yjs;
    // StrictMode 会立即执行一次 mount/cleanup 再正式挂载；yjs.init 是异步长流程
    // （等 provider sync），并发的两次 init 会互相打断。用宏任务延迟一拍，
    // 让被 StrictMode 立刻清理的首次 effect 不真正发起 init。
    let active = true;
    let started = false;
    let cleanupBootstrap: (() => void) | null = null;
    cachedCollabContentRef.current = false;
    localCollabPersistenceReadyRef.current = false;
    remoteCollabAuthenticatedRef.current = false;
    const timer = setTimeout(() => {
      if (!active) return;

      started = true;
      let remoteConnectStarted = false;
      let remoteConnectTimer: number | null = null;
      const connectRemote = () => {
        if (!active || remoteConnectStarted) return;
        remoteConnectStarted = true;

        if (remoteConnectTimer !== null) {
          window.clearTimeout(remoteConnectTimer);
          remoteConnectTimer = null;
        }

        yjs.connect("hocuspocus");
      };
      const bootstrap = deferYjsEditorConnectionUntilInitialSync(editor, {
        onConnected: () => {
          if (!active) return;

          // 首次加载不建立末尾选区：页面没有自动聚焦，而大文档末尾选区会
          // 触发 selection overlay 跨窗口测量；用户点击正文后再建立真实选区。
          editor.tf.init({
            shouldNormalizeEditor: false,
            value: null,
          });
          editor.api.onChange();

          setEditorReady(true);
        },
        onError: (error) => {
          console.warn("collab editor hydration failed", error);
        },
        shouldConnectOnSync: ({ type }) => {
          if (type !== "indexeddb") return true;

          localCollabPersistenceReadyRef.current = true;
          const yjsOptions = editor.getOptions(YjsPlugin);
          const sharedRoot =
            yjsOptions.sharedType ?? yjsOptions.ydoc?.get("content", Y.XmlText);
          const localProvider = yjsOptions._providers.find(
            (provider) => provider.type === "indexeddb",
          );
          const providerRoot = localProvider?.document.get("content", Y.XmlText);
          performance.mark(
            `sharebrain:editor-yjs:cache-root:${sharedRoot?.length ?? -1}:${providerRoot?.length ?? -1}`,
          );
          cachedCollabContentRef.current = Boolean(
            sharedRoot && sharedRoot.length > 0,
          );
          connectRemote();

          return (
            remoteCollabAuthenticatedRef.current &&
            cachedCollabContentRef.current
          );
        },
      });
      collabBootstrapRef.current = bootstrap;

      void Promise.resolve()
        .then(() =>
          yjs.init({
            autoConnect: false,
            id: `document:${documentId}`,
            // Collab 在无 CRDT snapshot 时从最新正文版本引导。客户端绝不能在
            // provider 同步超时后回填 HTTP 正文，否则远端快照会与整篇正文合并。
            value: null,
          }),
        )
        .then(() => {
          bootstrap.finishInitialization();

          if (!active) return;

          yjs.connect("indexeddb");
          if (!remoteConnectStarted) {
            remoteConnectTimer = window.setTimeout(connectRemote, 1_000);
          }

          if (bootstrap.isConnected()) {
            setEditorReady(true);
          }
        })
        .catch((error: unknown) => {
          bootstrap.finishInitialization();
          console.warn("collab init failed", error);
        });

      cleanupBootstrap = () => {
        if (remoteConnectTimer !== null) {
          window.clearTimeout(remoteConnectTimer);
          remoteConnectTimer = null;
        }
        if (collabBootstrapRef.current === bootstrap) {
          collabBootstrapRef.current = null;
        }
        bootstrap.dispose();
      };
    }, 0);

    return () => {
      active = false;
      clearTimeout(timer);
      cleanupBootstrap?.();

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

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (!editorReady) return;

    event.preventDefault();

    const firstNode = editor.children[0];

    if (firstNode && editor.api.isEmpty(firstNode as TElement)) {
      const start = editor.api.start([0]);

      if (start) {
        editor.tf.select(start);
      }
    } else {
      editor.tf.insertNodes(editor.api.create.block({ type: KEYS.p }), {
        at: [0],
        select: true,
      });
    }

    editor.tf.focus();
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["Backspace", "Delete", "Clear"].includes(event.key)) return;
    if (!editor.selection || !editor.api.isCollapsed()) return;
    if (editor.selection.focus.path[0] !== 0 || editor.children.length <= 1) return;

    const firstNode = editor.children[0];

    if (!firstNode || !editor.api.isEmpty(firstNode as TElement)) return;

    event.preventDefault();
    editor.tf.removeNodes({ at: [0] });

    const start = editor.api.start([0]);

    if (start) {
      editor.tf.select(start);
    }

    editor.tf.focus();
  };

  const handleEditorPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const payload = getEditorWordClipboardPayload(event.clipboardData);

    if (!payload) return;

    event.preventDefault();
    const selection = editor.selection
      ? structuredClone(editor.selection)
      : null;

    void parseEditorWordClipboard(editor, payload)
      .then((nodes) => {
        if (selection) editor.tf.select(selection);
        editor.tf.insertFragment(nodes);
      })
      .catch((error: unknown) => {
        console.warn("Word clipboard import failed", error);
      });
  };

  const getLiveVersionValue = useCallback(() => {
    const snapshot = cloneEditorVersionValue(editor.children as Value);
    return toPlateValue(projectDocumentVersionValue(snapshot));
  }, [editor]);
  const getLiveVersionBaseStateVector = useCallback(
    () => encodeDocumentStateVector(editor.getOptions(YjsPlugin).ydoc),
    [editor],
  );

  const openHistoryPanel = (tab: DocumentHistoryTab) => {
    setHistorySnapshot(null);
    setActivityRevision(null);
    setHistoryPanel({ open: true, tab });
  };

  const openVersionHistory = (selectedKey = CURRENT_DOCUMENT_VERSION_KEY) => {
    setActivityRevision(null);
    setHistorySnapshot({ selectedKey });
  };

  const closeHistory = () => {
    setHistorySnapshot(null);
    setActivityRevision(null);
    setHistoryPanel((current) => ({ ...current, open: false }));
  };

  return (
    <main className="editor-page">
      <EditorUploadProvider
        uploadFile={uploadEditorFile}
        onError={(error) => {
          console.error("editor media upload failed", error);
        }}
      >
        <Plate editor={editor}>
          <EditableChunkWindowProvider
            documentKey={documentId}
            enabled={runtimeEnv.WEB_PUBLIC_EDITOR_WINDOWING_ENABLED}
            longTaskThresholdMs={runtimeEnv.WEB_PUBLIC_EDITOR_WINDOWING_LONG_TASK_MS}
            maxFallbackRatio={runtimeEnv.WEB_PUBLIC_EDITOR_WINDOWING_MAX_FALLBACK_RATIO}
            maxRevealFailures={runtimeEnv.WEB_PUBLIC_EDITOR_WINDOWING_MAX_REVEAL_FAILURES}
            minimumBlockCount={runtimeEnv.WEB_PUBLIC_EDITOR_WINDOWING_MIN_BLOCKS}
            overscanPx={documentEditorOverscanPx}
            scrollRoot="viewport"
          >
          <NotionToolbar className="fixed inset-x-0 top-0 z-30 grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-0 bg-background/95 px-5 py-2 text-sm shadow-none backdrop-blur-md max-sm:min-h-12 max-sm:px-3 max-sm:py-1.5">
            <div className="flex min-w-0 items-center gap-1 justify-self-start">
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground"
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
              <span className="min-w-0 max-w-[260px] truncate text-[13px] font-medium text-muted-foreground leading-tight max-sm:max-w-[42vw]">
                {title || m.common_untitled()}
              </span>
            </div>
            <div className="flex min-w-0 items-center justify-self-end gap-px">
              {capabilities?.activityHistoryRead || capabilities?.versionHistoryRead ? (
                <DocumentHistoryButton
                  onClick={() =>
                    openHistoryPanel(capabilities?.activityHistoryRead ? "activity" : "versions")
                  }
                />
              ) : null}
              <CommentsPopoverButton />
              <SuggestionModeToggle />
              <EditorMoreMenu
                fileName={title || "document"}
                {...(capabilities?.versionHistoryRead
                  ? {
                      onOpenVersionHistory: () => openHistoryPanel("versions"),
                      versionHistoryLabel: m.document_version_title(),
                    }
                  : {})}
              />
              <AccountMenu />
            </div>
          </NotionToolbar>
          <article className="markdown-editor">
            <Input
              value={title}
              onChange={(event) => setTitle(normalizeDocumentTitleInput(event.target.value))}
              onKeyDown={handleTitleKeyDown}
              aria-label={m.module_document_title_aria()}
              className="title-input rounded-none hover:bg-transparent focus-visible:border-transparent focus-visible:bg-transparent focus-visible:ring-0"
            />
            <EditorContainer variant="document" className="min-h-[70vh] min-w-0">
              <Editor
                variant="none"
                readOnly={!editorReady}
                aria-hidden={!editorReady ? true : undefined}
                className={`min-h-[56vh] min-w-0 w-full px-[var(--editor-content-gutter)] pt-0 pb-36 text-base leading-7 text-foreground ${
                  editorReady ? "" : "pointer-events-none absolute inset-0 invisible"
                }`}
                placeholder={m.document_editor_placeholder()}
                renderChunk={DocumentEditorChunk}
                onKeyDown={handleEditorKeyDown}
                onPaste={handleEditorPaste}
              />
              {!editorReady && initialPreviewValue ? (
                <VersionPreview
                  value={initialPreviewValue}
                  className="min-h-[56vh] min-w-0 w-full px-[var(--editor-content-gutter)] pt-0 pb-36 text-base leading-7 text-foreground"
                />
              ) : null}
            </EditorContainer>
          </article>
          <EditorWindowFind />
          <EditorTocSidebar contentReady={editorReady} />
          </EditableChunkWindowProvider>
          {historySnapshot ? (
            <DocumentVersionHistory
              documentId={documentId}
              initialSelectedKey={historySnapshot.selectedKey}
              currentActor={{
                id: user.id,
                displayName: user.displayName,
                avatarUrl: user.avatar.url,
              }}
              memberAvatarUrls={participantDirectory.avatarUrls}
              canRestore={Boolean(capabilities?.versionHistoryRestore)}
              getCollabProvider={() => getEditorCollabProvider(editor)}
              getLiveBaseStateVector={getLiveVersionBaseStateVector}
              getLiveValue={getLiveVersionValue}
              onClose={() => setHistorySnapshot(null)}
            />
          ) : null}
          <DocumentHistoryPanel
            documentId={documentId}
            open={historyPanel.open}
            suspended={Boolean(historySnapshot || activityRevision)}
            tab={historyPanel.tab}
            canReadActivity={Boolean(capabilities?.activityHistoryRead)}
            canReadVersions={Boolean(capabilities?.versionHistoryRead)}
            currentActor={{
              id: user.id,
              displayName: user.displayName,
              avatarUrl: user.avatar.url,
            }}
            memberAvatarUrls={participantDirectory.avatarUrls}
            onTabChange={(tab) => setHistoryPanel((current) => ({ ...current, tab }))}
            onClose={closeHistory}
            onOpenActivityRevision={(activityId) => {
              setHistorySnapshot(null);
              setActivityRevision(activityId);
            }}
            onOpenVersion={openVersionHistory}
          />
          {activityRevision ? (
            <DocumentActivityRevision
              documentId={documentId}
              activityId={activityRevision}
              canRestore={Boolean(capabilities?.versionHistoryRestore)}
              getCollabProvider={() => getEditorCollabProvider(editor)}
              getLiveBaseStateVector={getLiveVersionBaseStateVector}
              onBack={() => setActivityRevision(null)}
              onClose={closeHistory}
            />
          ) : null}
        </Plate>
      </EditorUploadProvider>
    </main>
  );
}
