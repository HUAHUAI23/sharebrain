// 渲染跨路由常驻的知识聊天面板、会话历史、引用解释与反馈交互。
import {
  AI_CHAT_ATTACHMENT_MEDIA_TYPES,
  isImageAttachment,
  isSupportedChatAttachment,
  type AiCitation,
  type AiConversation,
  type AiChatDebugTrace,
  type AiFeedback,
  type AiMessage,
  type AiRunStep,
  type KnowledgeScope,
} from "@sharebrain/contracts";
import { m } from "@sharebrain/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@sharebrain/ui/components/alert-dialog";
import { Button } from "@sharebrain/ui/components/button";
import { Checkbox } from "@sharebrain/ui/components/checkbox";
import { ScrollArea } from "@sharebrain/ui/components/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@sharebrain/ui/components/sheet";
import { Textarea } from "@sharebrain/ui/components/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@sharebrain/ui/components/tooltip";
import { useIsMobile } from "@sharebrain/ui/hooks/use-mobile";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  ChevronLeft,
  ExternalLink,
  File as FileIcon,
  History,
  MessageSquareText,
  PanelRightClose,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { apiRequest, queryKeys } from "../../lib/api-client";
import { retryKnowledgeChat, streamKnowledgeChat } from "./knowledge-chat.client";
import { uploadKnowledgeChatAttachment } from "./knowledge-chat-attachment";
import { ChatAttachmentList, type ChatAttachmentView } from "./knowledge-chat-attachment-view";
import { ChatMarkdown } from "./knowledge-chat-markdown";
import { ChatSteps } from "./knowledge-chat-steps";
import { ChatStreamBuffer } from "./knowledge-chat-stream-buffer";
import { useChatPanelWidth } from "./knowledge-chat-resize";
import { useStickToBottom } from "./knowledge-chat-follow";
import { useKnowledgeChatStore } from "./knowledge-chat.store";

type ConversationsResponse = { items: AiConversation[]; nextCursor: string | null };
type MessagesResponse = { items: AiMessage[]; nextCursor: string | null };
/** 正文不放这里：它每帧都在变，交给 ChatStreamBuffer，只有正在输出的气泡订阅。 */
type OptimisticTurn = {
  userText: string;
  citations: AiCitation[];
  scope: KnowledgeScope | null;
  steps: AiRunStep[];
  usage: Record<string, unknown>;
  debugTrace: AiChatDebugTrace | null;
  attachments: AttachmentDraft[];
};

const ATTACHMENT_ACCEPT = AI_CHAT_ATTACHMENT_MEDIA_TYPES
  .map((prefix) => (prefix.endsWith("/") ? `${prefix}*` : prefix))
  .join(",");

/** 步骤按 kind 覆盖写入，同一步骤的 running -> complete 不会堆成两行。 */
function mergeStep(steps: AiRunStep[], step: AiRunStep): AiRunStep[] {
  const index = steps.findIndex((item) => item.kind === step.kind);
  if (index < 0) return [...steps, step];
  const next = [...steps];
  next[index] = step;
  return next;
}
type PendingScopeChoice = {
  message: string;
  projects: KnowledgeScope["ambiguousProjects"];
};
type AttachmentDraft = {
  localId: string;
  mediaObjectId: string | null;
  fileName: string;
  mimeType: string;
  byteSize: number;
  progress: number;
  status: "uploading" | "ready" | "failed";
  previewUrl: string | null;
};

export function KnowledgeChatPanel() {
  const isMobile = useIsMobile();
  const matchRoute = useMatchRoute();
  const projectMatch = matchRoute({ to: "/projects/$projectId", fuzzy: true });
  const activeProjectId = projectMatch ? projectMatch.projectId : null;
  const open = useKnowledgeChatStore((state) => state.open);
  const setOpen = useKnowledgeChatStore((state) => state.setOpen);
  const toggleOpen = useKnowledgeChatStore((state) => state.toggleOpen);
  const { width, resizing, startResize } = useChatPanelWidth();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggleOpen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleOpen]);

  return (
    <>
      {!open ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-lg"
              className="fixed right-5 bottom-5 z-40 rounded-full shadow-md"
              aria-label={m.chat_open()}
              onClick={() => setOpen(true)}
            >
              <MessageSquareText />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{m.chat_open()}</TooltipContent>
        </Tooltip>
      ) : null}

      {isMobile ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="inset-0 h-[100dvh] w-full border-0"
            showCloseButton={false}
          >
            <SheetTitle className="sr-only">{m.chat_title()}</SheetTitle>
            <SheetDescription className="sr-only">{m.chat_description()}</SheetDescription>
            <KnowledgeChatSurface activeProjectId={activeProjectId} onClose={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
      ) : open ? (
        <aside
          className="fixed top-3 right-3 bottom-3 z-40 overflow-hidden rounded-lg border border-border bg-background shadow-lg"
          style={{ width }}
        >
          {/* 左边缘拖拽把手。命中区 8px，视觉只有 1px，不打扰正文。 */}
          <div
            className="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize touch-none before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-transparent hover:before:bg-border data-[resizing=true]:before:bg-foreground/20"
            data-resizing={resizing}
            role="separator"
            aria-orientation="vertical"
            aria-label={m.chat_resize()}
            onPointerDown={startResize}
          />
          <KnowledgeChatSurface activeProjectId={activeProjectId} onClose={() => setOpen(false)} />
        </aside>
      ) : null}
    </>
  );
}

function KnowledgeChatSurface({
  activeProjectId,
  onClose,
}: {
  activeProjectId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const selectedConversationId = useKnowledgeChatStore((state) => state.selectedConversationId);
  const newConversationRequested = useKnowledgeChatStore((state) => state.newConversationRequested);
  const startNewConversation = useKnowledgeChatStore((state) => state.startNewConversation);
  const selectConversation = useKnowledgeChatStore((state) => state.selectConversation);
  const showConversations = useKnowledgeChatStore((state) => state.showConversations);
  const setShowConversations = useKnowledgeChatStore((state) => state.setShowConversations);
  const [draft, setDraft] = useState("");
  const [includeCrossProject, setIncludeCrossProject] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<OptimisticTurn | null>(null);
  const [debugByRunId, setDebugByRunId] = useState<Record<string, AiChatDebugTrace>>({});
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingScopeChoice, setPendingScopeChoice] = useState<PendingScopeChoice | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef(new Set<string>());
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const streamBuffer = useMemo(() => new ChatStreamBuffer(), []);

  const revokePreview = useCallback((previewUrl: string | null) => {
    if (!previewUrl) return;
    URL.revokeObjectURL(previewUrl);
    previewUrlsRef.current.delete(previewUrl);
  }, []);

  useEffect(() => () => {
    for (const previewUrl of previewUrlsRef.current) URL.revokeObjectURL(previewUrl);
    previewUrlsRef.current.clear();
  }, []);

  const conversations = useInfiniteQuery({
    queryKey: queryKeys.aiConversations,
    queryFn: ({ pageParam }) => apiRequest<ConversationsResponse>(
      `/api/ai/conversations${pageParam ? `?cursor=${pageParam}` : ""}`,
    ),
    initialPageParam: "" as string,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const messages = useInfiniteQuery({
    queryKey: queryKeys.aiMessages(selectedConversationId ?? "new"),
    queryFn: ({ pageParam }) => apiRequest<MessagesResponse>(
      `/api/ai/conversations/${selectedConversationId}/messages${pageParam ? `?cursor=${pageParam}` : ""}`,
    ),
    initialPageParam: "" as string,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(selectedConversationId),
    refetchInterval: (query) => {
      const data = query.state.data as { pages?: MessagesResponse[] } | undefined;
      return data?.pages?.some((page) => page.items.some((message) => message.status === "streaming"))
        ? 1_000
        : false;
    },
  });

  const activeConversationTitle = conversations.data?.pages
    .flatMap((page) => page.items)
    .find((item) => item.id === selectedConversationId)?.title ?? null;

  useEffect(() => {
    const firstConversation = conversations.data?.pages[0]?.items[0];
    if (!selectedConversationId && !optimistic && !newConversationRequested && firstConversation) {
      selectConversation(firstConversation.id);
    }
  }, [conversations.data?.pages, newConversationRequested, optimistic, selectConversation, selectedConversationId]);

  // 刻意不在卸载时中止：关闭面板不该丢掉正在生成的回答，durable run 会把它写完，
  // 重新打开时从 REST 历史读回。只有"停止"按钮才是用户明确的中止意图。

  const deleteConversation = useMutation({
    mutationFn: (conversationId: string) => apiRequest<{ ok: boolean }>(
      `/api/ai/conversations/${conversationId}`,
      { method: "DELETE" },
    ),
    async onSuccess(_, conversationId) {
      setPendingDeleteId(null);
      if (selectedConversationId === conversationId) selectConversation(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.aiConversations });
    },
  });

  const runTurn = async (message: string, explicitProjectId?: string) => {
    const readyAttachments = attachments.filter((attachment) =>
      attachment.status === "ready" && attachment.mediaObjectId);
    const readyAttachmentIds = new Set(readyAttachments.map((attachment) => attachment.localId));
    // 未上传成功的附件不会进入消息，丢弃输入态时必须同步释放它们的本地预览。
    for (const attachment of attachments) {
      if (!readyAttachmentIds.has(attachment.localId)) revokePreview(attachment.previewUrl);
    }
    // 上一次交接失败时乐观消息仍可能存在；新一轮发送会替换它，避免遗留 Blob URL。
    for (const attachment of optimistic?.attachments ?? []) revokePreview(attachment.previewUrl);
    setStreaming(true);
    setStreamError(null);
    streamBuffer.reset();
    setOptimistic({
      userText: message,
      citations: [],
      scope: null,
      steps: [],
      usage: {},
      debugTrace: null,
      attachments: readyAttachments,
    });
    setAttachments([]);
    const controller = new AbortController();
    abortRef.current = controller;
    let conversationId: string | null = selectedConversationId;
    let runId: string | null = null;
    let debugTrace: AiChatDebugTrace | null = null;
    try {
      await streamKnowledgeChat({
        ...(selectedConversationId ? { conversationId: selectedConversationId } : {}),
        message,
        activeProjectId,
        ...(explicitProjectId ? { explicitProjectId } : {}),
        includeCrossProject,
        attachments: readyAttachments.flatMap((attachment) =>
          attachment.mediaObjectId ? [attachment.mediaObjectId] : []),
      }, {
        // 服务端明确告知会话 id，新会话不再靠时间戳猜。
        onRun(run) {
          conversationId = run.conversationId;
          runId = run.id;
        },
        onScope(scope) {
          setOptimistic((current) => current ? { ...current, scope } : current);
        },
        onStep(step) {
          setOptimistic((current) => current
            ? { ...current, steps: mergeStep(current.steps, step) }
            : current);
        },
        onCitations(citations) {
          setOptimistic((current) => current ? { ...current, citations } : current);
        },
        onDebug(trace) {
          debugTrace = trace;
          setOptimistic((current) => current ? { ...current, debugTrace: trace } : current);
        },
        onFinish(usage) {
          setOptimistic((current) => current ? { ...current, usage } : current);
        },
        // 正文绕开 React state：缓冲区按帧释放，面板与会话列表不参与重渲染。
        onText(delta) {
          streamBuffer.push(delta);
        },
        onError(error) {
          setStreamError(error.message);
        },
      }, controller.signal);
      streamBuffer.flush();
    } catch (error) {
      if (!controller.signal.aborted) {
        setStreamError(error instanceof Error ? error.message : m.chat_error());
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      // 先把服务端消息灌进缓存，确认替代内容已经在手，再撤掉本地流式态。
      // 反过来做会出现一段空窗：回答已经从界面消失，REST 还没回来。
      await handoffToServer(
        conversationId ?? selectedConversationId,
        readyAttachments.flatMap((attachment) => attachment.previewUrl ? [attachment.previewUrl] : []),
        runId,
        debugTrace,
      );
    }
  };

  /**
   * 流式结束后的交接。乐观态只有在服务端消息确实进了缓存之后才清除，
   * 因此界面上不存在"回答先消失、过一会儿再出现"的中间态。
   */
  const handoffToServer = async (
    conversationId: string | null,
    previewUrls: string[],
    runId: string | null,
    debugTrace: AiChatDebugTrace | null,
  ) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.aiConversations });
    if (!conversationId) {
      // 拿不到会话 id 时宁可留着本地结果，也不要把回答抹掉。
      return;
    }
    try {
      const page = await apiRequest<MessagesResponse>(
        `/api/ai/conversations/${conversationId}/messages`,
      );
      queryClient.setQueryData(queryKeys.aiMessages(conversationId), {
        pages: [page],
        pageParams: [""],
      });
      if (runId && debugTrace) {
        setDebugByRunId((current) => ({ ...current, [runId]: debugTrace }));
      }
      if (conversationId !== selectedConversationId) selectConversation(conversationId);
      for (const previewUrl of previewUrls) revokePreview(previewUrl);
      setOptimistic(null);
    } catch {
      // 保留本地流结果，下一次成功刷新会以 REST 历史替换它。
    }
  };

  const send = async () => {
    const message = draft.trim();
    if (!message || streaming) return;
    setStreamError(null);
    try {
      const scope = await apiRequest<KnowledgeScope>("/api/ai/scope", {
        method: "POST",
        body: { message, activeProjectId, includeCrossProject },
      });
      setDraft("");
      if (scope.ambiguousProjects.length > 1) {
        setPendingScopeChoice({ message, projects: scope.ambiguousProjects });
        return;
      }
      await runTurn(message);
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : m.chat_error());
    }
  };

  const addAttachments = (files: FileList | File[] | null) => {
    if (!files) return;
    const available = Math.max(0, 8 - attachments.length);
    // 模型读不了的类型在这里就挡住，不让它走到 provider 转换阶段把整条回答带崩。
    const supported = Array.from(files).filter((file) =>
      isSupportedChatAttachment(file.type || "application/octet-stream"));
    if (supported.length < files.length) setStreamError(m.chat_attachment_unsupported());
    for (const file of supported.slice(0, available)) {
      const uploadFile = file.name
        ? file
        : new globalThis.File([file], isImageAttachment(file.type) ? "pasted-image.png" : "pasted-file", {
            type: file.type,
            lastModified: file.lastModified,
          });
      const localId = crypto.randomUUID();
      const draft: AttachmentDraft = {
        localId,
        mediaObjectId: null,
        fileName: uploadFile.name,
        mimeType: uploadFile.type || "application/octet-stream",
        byteSize: uploadFile.size,
        progress: 0,
        status: "uploading",
        previewUrl: isImageAttachment(uploadFile.type) ? URL.createObjectURL(uploadFile) : null,
      };
      if (draft.previewUrl) previewUrlsRef.current.add(draft.previewUrl);
      setAttachments((current) => [...current, draft]);
      void uploadKnowledgeChatAttachment(uploadFile, (progress) => {
        setAttachments((current) => current.map((item) =>
          item.localId === localId ? { ...item, progress } : item));
      }).then((media) => {
        setAttachments((current) => current.map((item) => item.localId === localId
          ? { ...item, mediaObjectId: media.id, progress: 100, status: "ready" }
          : item));
      }).catch(() => {
        setAttachments((current) => current.map((item) => {
          if (item.localId !== localId) return item;
          revokePreview(item.previewUrl);
          return { ...item, previewUrl: null, status: "failed" };
        }));
      });
    }
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
  };

  return (
    <>
    <div className="grid h-full min-h-0 grid-rows-[44px_minmax(0,1fr)_auto] bg-background">
      {/* 标题栏只留身份与动作：面板是什么已经由它出现的位置说明了，不需要头像和副标题。 */}
      <header className="flex min-w-0 items-center gap-1 px-2">
        {showConversations ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={m.common_back()}
            onClick={() => setShowConversations(false)}
          >
            <ChevronLeft />
          </Button>
        ) : null}
        <h2 className="min-w-0 flex-1 truncate px-1.5 text-[13px] font-medium">
          {showConversations
            ? m.chat_conversations()
            : activeConversationTitle ?? m.chat_new_conversation()}
        </h2>
        {!showConversations ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={m.chat_new()}
              disabled={streaming}
              onClick={() => {
                for (const attachment of optimistic?.attachments ?? []) revokePreview(attachment.previewUrl);
                startNewConversation();
                setDraft("");
                setPendingScopeChoice(null);
                setStreamError(null);
                for (const attachment of attachments) revokePreview(attachment.previewUrl);
                setAttachments([]);
                setOptimistic(null);
              }}
            >
              <Plus />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={m.chat_conversations()} onClick={() => setShowConversations(true)}>
              <History />
            </Button>
          </>
        ) : null}
        <Button type="button" variant="ghost" size="icon-sm" aria-label={m.common_close()} onClick={onClose}>
          <PanelRightClose />
        </Button>
      </header>

      {showConversations ? (
        <ConversationList
          conversations={conversations.data?.pages.flatMap((page) => page.items) ?? []}
          loading={conversations.isLoading}
          hasMore={conversations.hasNextPage}
          loadingMore={conversations.isFetchingNextPage}
          selectedId={selectedConversationId}
          onSelect={(conversationId) => {
            for (const attachment of optimistic?.attachments ?? []) revokePreview(attachment.previewUrl);
            setOptimistic(null);
            selectConversation(conversationId);
          }}
          onDelete={setPendingDeleteId}
          onLoadMore={() => void conversations.fetchNextPage()}
        />
      ) : (
        <MessageList
          messages={[...(messages.data?.pages ?? [])].reverse().flatMap((page) => page.items)}
          loading={messages.isLoading}
          optimistic={optimistic}
          streamBuffer={streamBuffer}
          debugByRunId={debugByRunId}
          hasOlder={messages.hasNextPage}
          loadingOlder={messages.isFetchingNextPage}
          onLoadOlder={() => messages.fetchNextPage()}
        />
      )}

      {!showConversations ? (
        <footer className="border-t border-border p-3">
          {pendingScopeChoice ? (
            <div className="mb-2 grid gap-2 rounded-md border border-border bg-muted/30 p-2.5">
              <p className="text-xs font-medium">{m.chat_scope_choose()}</p>
              <div className="flex flex-wrap gap-1.5">
                {pendingScopeChoice.projects.map((candidate) => (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    key={candidate.id}
                    disabled={streaming}
                    onClick={() => {
                      const pending = pendingScopeChoice;
                      setPendingScopeChoice(null);
                      void runTurn(pending.message, candidate.id);
                    }}
                  >
                    {candidate.name}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={streaming}
                  onClick={() => {
                    setDraft(pendingScopeChoice.message);
                    setPendingScopeChoice(null);
                  }}
                >
                  {m.common_cancel()}
                </Button>
              </div>
            </div>
          ) : null}
          {streamError ? (
            <p className="mb-2 rounded-md bg-destructive/8 px-2.5 py-2 text-xs text-destructive" role="alert">
              {streamError}
            </p>
          ) : null}
          <div className="rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring/30">
            {attachments.length > 0 ? (
              <div className="flex min-w-0 flex-wrap gap-1.5 border-b border-border/70 p-2">
                {attachments.map((attachment) => (
                  <span
                    key={attachment.localId}
                    className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-sm bg-muted px-2 py-1 text-[11px]"
                  >
                    <FileIcon className="size-3.5 shrink-0" />
                    <span className="max-w-44 truncate">{attachment.fileName}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {attachment.status === "uploading"
                        ? `${attachment.progress}%`
                        : attachment.status === "failed"
                          ? m.chat_attachment_failed()
                          : null}
                    </span>
                    <button
                      type="button"
                      className="grid size-4 shrink-0 place-items-center border-0 bg-transparent text-muted-foreground hover:text-foreground"
                      aria-label={m.chat_attachment_remove()}
                      onClick={() => {
                        revokePreview(attachment.previewUrl);
                        setAttachments((current) =>
                          current.filter((item) => item.localId !== attachment.localId));
                      }}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <Textarea
              className="max-h-40 min-h-16 resize-none border-0 bg-transparent px-3 py-2.5 shadow-none focus-visible:ring-0"
              value={draft}
              placeholder={m.chat_placeholder()}
              aria-label={m.chat_placeholder()}
              disabled={streaming}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={(event) => {
                const itemFiles = Array.from(event.clipboardData.items)
                  .filter((item) => item.kind === "file")
                  .map((item) => item.getAsFile())
                  .filter((file): file is globalThis.File => file !== null);
                const pastedFiles = itemFiles.length > 0
                  ? itemFiles
                  : Array.from(event.clipboardData.files);
                const hasSupportedFile = pastedFiles.some((file) =>
                  isSupportedChatAttachment(file.type || "application/octet-stream"));
                if (!hasSupportedFile || attachments.length >= 8) return;
                event.preventDefault();
                addAttachments(pastedFiles);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="flex min-h-9 items-center gap-2 border-t border-border/70 px-2">
              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                accept={ATTACHMENT_ACCEPT}
                className="sr-only"
                onChange={(event) => addAttachments(event.currentTarget.files)}
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={streaming || attachments.length >= 8}
                aria-label={m.chat_attachment_add()}
                onClick={() => attachmentInputRef.current?.click()}
              >
                <Paperclip />
              </Button>
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
                <Checkbox
                  checked={includeCrossProject}
                  onCheckedChange={(checked) => setIncludeCrossProject(checked === true)}
                />
                <span className="truncate">{m.chat_cross_project()}</span>
              </label>
              {streaming ? (
                // 生成中把发送位换成停止：模型久久不出字时用户得有出口，而不是干等。
                <Button
                  type="button"
                  size="icon-sm"
                  variant="secondary"
                  aria-label={m.chat_stop()}
                  onClick={() => abortRef.current?.abort()}
                >
                  <Square className="fill-current" />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="icon-sm"
                  disabled={!draft.trim() || attachments.some((item) => item.status === "uploading")}
                  aria-label={m.chat_send()}
                  onClick={() => void send()}
                >
                  <Send />
                </Button>
              )}
            </div>
          </div>
        </footer>
      ) : <div />}
    </div>
      <AlertDialog open={pendingDeleteId !== null} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{m.chat_delete_confirm_title()}</AlertDialogTitle>
            <AlertDialogDescription>{m.chat_delete_confirm_description()}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteConversation.isPending}
              onClick={() => pendingDeleteId && deleteConversation.mutate(pendingDeleteId)}
            >
              {m.chat_delete()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ConversationList({
  conversations,
  loading,
  hasMore,
  loadingMore,
  selectedId,
  onSelect,
  onDelete,
  onLoadMore,
}: {
  conversations: AiConversation[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  selectedId: string | null;
  onSelect: (conversationId: string) => void;
  onDelete: (conversationId: string) => void;
  onLoadMore: () => void;
}) {
  return (
    <ScrollArea className="min-h-0">
      <div className="grid gap-1 p-2">
        {loading ? <p className="p-4 text-sm text-muted-foreground">{m.common_loading()}</p> : null}
        {!loading && conversations.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{m.chat_conversations_empty()}</p>
        ) : null}
        {conversations.map((conversation) => (
          <div
            className="group grid grid-cols-[minmax(0,1fr)_28px] items-center gap-1 rounded-md hover:bg-accent"
            data-active={selectedId === conversation.id}
            key={conversation.id}
          >
            <button
              type="button"
              className="min-w-0 border-0 bg-transparent px-3 py-2.5 text-left"
              onClick={() => onSelect(conversation.id)}
            >
              <span className="block truncate text-[13px] font-medium">{conversation.title}</span>
              <span className="block text-[11px] text-muted-foreground">
                {new Date(conversation.updatedAt).toLocaleDateString()}
              </span>
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={m.chat_delete()}
              onClick={() => onDelete(conversation.id)}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        {hasMore ? (
          <Button type="button" size="sm" variant="ghost" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? m.common_loading() : m.chat_conversations_load_more()}
          </Button>
        ) : null}
      </div>
    </ScrollArea>
  );
}

function MessageList({
  messages,
  loading,
  optimistic,
  streamBuffer,
  debugByRunId,
  hasOlder,
  loadingOlder,
  onLoadOlder,
}: {
  messages: AiMessage[];
  loading: boolean;
  optimistic: OptimisticTurn | null;
  streamBuffer: ChatStreamBuffer;
  debugByRunId: Record<string, AiChatDebugTrace>;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => Promise<unknown>;
}) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const getViewport = useCallback(() => scrollAreaRef.current
    ?.querySelector<HTMLElement>("[data-slot='scroll-area-viewport']") ?? null, []);
  const getContent = useCallback(() => contentRef.current, []);
  const { reattach, detached } = useStickToBottom({ getViewport, getContent });
  const loadOlder = async () => {
    const element = getViewport();
    const previousHeight = element?.scrollHeight ?? 0;
    const previousTop = element?.scrollTop ?? 0;
    await onLoadOlder();
    requestAnimationFrame(() => {
      if (element) element.scrollTop = previousTop + element.scrollHeight - previousHeight;
    });
  };
  return (
    <ScrollArea ref={scrollAreaRef} className="relative min-h-0">
      <div ref={contentRef} className="mx-auto grid w-full max-w-[680px] gap-5 p-4 [overflow-anchor:none]">
        {hasOlder ? (
          <Button type="button" size="sm" variant="ghost" disabled={loadingOlder} onClick={() => void loadOlder()}>
            {loadingOlder ? m.common_loading() : m.chat_load_older()}
          </Button>
        ) : null}
        {loading ? <p className="py-10 text-center text-sm text-muted-foreground">{m.common_loading()}</p> : null}
        {!loading && messages.length === 0 && !optimistic ? (
          <div className="grid min-h-72 place-content-center text-center">
            <p className="text-sm font-medium">{m.chat_empty_title()}</p>
          </div>
        ) : null}
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            {...(message.runId && debugByRunId[message.runId]
              ? { debug: debugByRunId[message.runId] }
              : {})}
          />
        ))}
        {optimistic ? (
          <>
            <ChatText
              role="user"
              text={optimistic.userText}
              attachments={optimistic.attachments.map((attachment) => ({
              mediaObjectId: attachment.mediaObjectId,
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
              previewUrl: attachment.previewUrl,
            }))}
            />
            <StreamingAnswer
              buffer={streamBuffer}
              citations={optimistic.citations}
              scope={optimistic.scope}
              steps={optimistic.steps}
              usage={optimistic.usage}
              debug={optimistic.debugTrace}
            />
          </>
        ) : null}
      </div>
      {detached ? (
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          className="absolute inset-x-0 bottom-3 mx-auto w-8 rounded-full border border-border"
          aria-label={m.chat_scroll_to_bottom()}
          onClick={reattach}
        >
          <ArrowDown />
        </Button>
      ) : null}
    </ScrollArea>
  );
}

/**
 * 正在流式输出的回答。只有它订阅缓冲区，因此每帧重渲染被限制在这一棵子树里，
 * 会话列表、历史消息和输入框都不受影响。
 */
function StreamingAnswer({
  buffer,
  citations,
  scope,
  steps,
  usage,
  debug,
}: {
  buffer: ChatStreamBuffer;
  citations: AiCitation[];
  scope: KnowledgeScope | null;
  steps: AiRunStep[];
  usage: Record<string, unknown>;
  debug: AiChatDebugTrace | null;
}) {
  const text = useSyncExternalStore(buffer.subscribe, buffer.getSnapshot);
  return (
    <ChatText
      role="assistant"
      // 工作过程一旦开始推送就由它交代进度，不再额外占一行"正在检索"。
      text={text || (steps.length > 0 ? "" : m.chat_thinking())}
      citations={citations}
      steps={steps}
      usage={usage}
      debug={debug}
      {...(steps.length > 0 ? {} : { scope })}
    />
  );
}

// 历史消息用 memo 隔离：流式期间面板会因步骤更新重渲染多次，历史条目不该跟着走一遍。
const ChatMessage = memo(function ChatMessage({
  message,
  debug,
}: {
  message: AiMessage;
  debug?: AiChatDebugTrace;
}) {
  const queryClient = useQueryClient();
  const [retryActive, setRetryActive] = useState(false);
  const [retryCitations, setRetryCitations] = useState<AiCitation[]>(message.citations);
  const [retrySteps, setRetrySteps] = useState<AiRunStep[]>([]);
  const [retryUsage, setRetryUsage] = useState<Record<string, unknown>>({});
  const [retryDebug, setRetryDebug] = useState<AiChatDebugTrace | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const retryAbortRef = useRef<AbortController | null>(null);
  const retryBuffer = useMemo(() => new ChatStreamBuffer(), []);
  const retryText = useSyncExternalStore(retryBuffer.subscribe, retryBuffer.getSnapshot);

  const text = message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
  const error = message.parts.find((part) => part.type === "error");
  const attachments = message.parts.filter((part): part is Extract<AiMessage["parts"][number], { type: "attachment" }> =>
    part.type === "attachment");
  const retry = async () => {
    if (!message.runId || retrying) return;
    const controller = new AbortController();
    retryAbortRef.current = controller;
    setRetrying(true);
    setRetryActive(true);
    retryBuffer.reset();
    setRetryCitations([]);
    setRetrySteps([]);
    setRetryUsage({});
    setRetryDebug(null);
    setRetryError(null);
    let streamFailed = false;
    try {
      await retryKnowledgeChat(message.runId, {
        onStep(step) {
          setRetrySteps((current) => mergeStep(current, step));
        },
        onCitations(citations) {
          setRetryCitations(citations);
        },
        onFinish(usage) {
          setRetryUsage(usage);
        },
        onDebug(trace) {
          setRetryDebug(trace);
        },
        onText(delta) {
          retryBuffer.push(delta);
        },
        onError(streamError) {
          streamFailed = true;
          setRetryError(streamError.message);
        },
      }, controller.signal);
      retryBuffer.flush();
      await queryClient.invalidateQueries({ queryKey: queryKeys.aiMessages(message.conversationId) });
      if (!streamFailed) setRetryActive(false);
    } catch (retryFailure) {
      if (!controller.signal.aborted) {
        setRetryError(retryFailure instanceof Error ? retryFailure.message : m.chat_error());
      }
    } finally {
      await queryClient.invalidateQueries({ queryKey: queryKeys.aiMessages(message.conversationId) });
      retryAbortRef.current = null;
      setRetrying(false);
    }
  };
  return (
    <ChatText
      messageId={message.id}
      role={message.role}
      text={retryActive
        ? retryText || m.chat_retrying()
        : text || (error?.type === "error" ? error.message : "")}
      citations={retryActive ? retryCitations : message.citations}
      steps={retryActive ? retrySteps : message.steps}
      usage={retryActive ? retryUsage : message.usage}
      // 重试结束后仍保留本次临时调试追踪；服务端历史不会落库 debug 数据。
      debug={retryActive ? retryDebug : retryDebug ?? debug ?? null}
      failed={message.status === "failed" && !retryActive}
      retrying={retrying}
      retryError={retryError}
      attachments={attachments.map((attachment) => ({
        mediaObjectId: attachment.mediaObjectId,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
      }))}
      {...(message.runId && message.status === "failed" ? { onRetry: () => void retry() } : {})}
    />
  );
});

function ChatText({
  messageId,
  role,
  text,
  citations = [],
  scope,
  steps = [],
  usage = {},
  debug = null,
  failed = false,
  retrying = false,
  retryError,
  onRetry,
  attachments = [],
}: {
  messageId?: string;
  role: "user" | "assistant";
  text: string;
  citations?: AiCitation[];
  scope?: KnowledgeScope | null;
  steps?: AiRunStep[];
  usage?: Record<string, unknown>;
  debug?: AiChatDebugTrace | null;
  failed?: boolean;
  retrying?: boolean;
  retryError?: string | null;
  onRetry?: () => void;
  attachments?: ChatAttachmentView[];
}) {
  const [feedbackVote, setFeedbackVote] = useState<AiFeedback["vote"] | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const feedback = useMutation({
    mutationFn: (value: AiFeedback) => apiRequest<{ ok: boolean }>(
      `/api/ai/messages/${messageId}/feedback`,
      { method: "POST", body: value },
    ),
    onMutate(value) {
      setFeedbackVote(value.vote);
      setFeedbackError(null);
    },
    onError(error) {
      setFeedbackVote(null);
      setFeedbackError(error instanceof Error ? error.message : m.chat_feedback_error());
    },
  });
  if (role === "user") {
    return (
      <div className="ml-auto grid max-w-[88%] gap-2 rounded-md bg-muted px-3 py-2 text-[13px] leading-6 whitespace-pre-wrap break-words">
        <span>{text}</span>
        <ChatAttachmentList attachments={attachments} />
      </div>
    );
  }
  return (
    <article className="min-w-0">
      {steps.length > 0 ? <ChatSteps steps={steps} usage={usage} /> : null}
      {debug ? <DebugTraceDetails trace={debug} /> : null}
      <ChatMarkdown text={text} />
      {failed ? <p className="mt-1 text-xs text-destructive">{m.chat_failed()}</p> : null}
      {scope ? (
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          {scope.ambiguousProjects.length > 1
            ? m.chat_scope_ambiguous({ count: scope.ambiguousProjects.length })
            : m.chat_scope_resolved({ name: scope.projectName ?? m.chat_scope_global() })}
        </p>
      ) : null}
      {citations.length > 0 ? <CitationList citations={citations} /> : null}
      {retryError ? <p className="mt-2 text-xs text-destructive">{retryError}</p> : null}
      {messageId || onRetry ? (
        <div className="mt-2 flex items-center gap-1">
          {onRetry ? (
            <Button type="button" variant="ghost" size="sm" disabled={retrying} onClick={onRetry}>
              <RotateCcw />
              {m.common_retry()}
            </Button>
          ) : null}
          {messageId ? (
            <>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={m.feedback_up()}
            aria-pressed={feedbackVote === "up"}
            className={feedbackVote === "up"
              ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
              : undefined}
            disabled={feedback.isPending}
            onClick={() => feedback.mutate({ vote: "up" })}
          >
            <ThumbsUp className={feedbackVote === "up" ? "fill-current" : undefined} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={m.feedback_down()}
            aria-pressed={feedbackVote === "down"}
            className={feedbackVote === "down"
              ? "bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:text-rose-300"
              : undefined}
            disabled={feedback.isPending}
            onClick={() => feedback.mutate({ vote: "down" })}
          >
            <ThumbsDown className={feedbackVote === "down" ? "fill-current" : undefined} />
          </Button>
            </>
          ) : null}
        </div>
      ) : null}
      {feedbackError ? <p className="mt-1 text-[11px] text-destructive">{feedbackError}</p> : null}
    </article>
  );
}

function DebugTraceDetails({ trace }: { trace: AiChatDebugTrace }) {
  return (
    <details className="mt-2 rounded-sm border border-dashed border-border/70 text-[11px]">
      <summary className="cursor-pointer px-2 py-1.5 text-muted-foreground hover:bg-muted/40">
        {m.chat_debug_details({ level: trace.level })}
      </summary>
      <div className="grid gap-2 border-t border-border/60 p-2">
        {trace.queryTerms?.length ? (
          <DebugValue label={m.chat_debug_query_terms()} value={trace.queryTerms.join(" · ")} />
        ) : null}
        {trace.query ? <DebugValue label={m.chat_debug_query()} value={trace.query} /> : null}
        {trace.tsQuery ? <DebugValue label={m.chat_debug_ts_query()} value={trace.tsQuery} /> : null}
        {trace.retrievalTrace ? (
          <DebugValue
            label={m.chat_debug_retrieval_trace()}
            value={JSON.stringify(trace.retrievalTrace, null, 2)}
            pre
          />
        ) : null}
        {trace.context ? <DebugValue label={m.chat_debug_context()} value={trace.context} pre /> : null}
        {trace.systemPrompt ? <DebugValue label={m.chat_debug_system_prompt()} value={trace.systemPrompt} pre /> : null}
        {trace.history?.length ? (
          <DebugValue
            label={m.chat_debug_history()}
            value={trace.history.map((item) => `[${item.role}]\n${item.content}`).join("\n\n")}
            pre
          />
        ) : null}
      </div>
    </details>
  );
}

function DebugValue({ label, value, pre = false }: { label: string; value: string; pre?: boolean }) {
  return (
    <div className="grid gap-0.5">
      <span className="font-medium text-foreground">{label}</span>
      {pre ? (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-muted/40 p-1.5 font-mono text-[10px] leading-4">
          {value}
        </pre>
      ) : <span className="break-words text-muted-foreground">{value}</span>}
    </div>
  );
}

function CitationList({ citations }: { citations: AiCitation[] }) {
  const projects = new Set(citations.map((citation) => citation.projectId));
  return (
    <details className="mt-3 rounded-md border border-border bg-muted/20">
      <summary className="cursor-pointer list-none px-3 py-2 text-[11px] font-medium text-muted-foreground">
        {m.chat_citations_summary({ count: citations.length, projects: projects.size })}
      </summary>
      <div className="grid gap-1.5 border-t border-border p-2">
        {citations.map((citation) => <CitationCard key={citation.id} citation={citation} />)}
      </div>
    </details>
  );
}

function CitationCard({ citation }: { citation: AiCitation }) {
  const navigate = useNavigate();
  const [feedbackVote, setFeedbackVote] = useState<AiFeedback["vote"] | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const feedback = useMutation({
    mutationFn: (value: AiFeedback) => apiRequest<{ ok: boolean }>(
      `/api/ai/citations/${citation.id}/feedback`,
      { method: "POST", body: value },
    ),
    onMutate(value) {
      setFeedbackVote(value.vote);
      setFeedbackError(null);
    },
    onError(error) {
      setFeedbackVote(null);
      setFeedbackError(error instanceof Error ? error.message : m.chat_feedback_error());
    },
  });
  const tier = citation.tier === "active_project"
    ? m.chat_tier_active()
    : citation.tier === "graph_expanded"
      ? m.chat_tier_graph()
      : m.chat_tier_global();
  return (
    <article className="min-w-0 rounded-md border border-border bg-background p-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <span className="inline-flex rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {tier}
          </span>
          <p className="mt-1 truncate text-xs font-semibold">{citation.title}</p>
          <p className="truncate text-[10px] text-muted-foreground">
            {[citation.projectName, ...citation.headingPath].filter(Boolean).join(" / ")}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={!citation.available || !citation.documentId}
          aria-label={m.chat_open_source()}
          onClick={() => {
            if (!citation.documentId) return;
            void navigate({
              to: "/documents/$documentId",
              params: { documentId: citation.documentId },
              hash: citation.blockIds[0] ?? "",
            });
          }}
        >
          <ExternalLink />
        </Button>
      </div>
      <p className="mt-2 line-clamp-3 text-[11px] leading-5 text-muted-foreground">
        {citation.snippet ?? m.chat_source_unavailable()}
      </p>
      {citation.retrieval.graphPath ? (
        <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
          {m.chat_graph_reason({ title: citation.retrieval.graphPath.seedTitle })}
        </p>
      ) : null}
      <div className="mt-1.5 flex justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={m.feedback_up()}
          aria-pressed={feedbackVote === "up"}
          className={feedbackVote === "up"
            ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
            : undefined}
          disabled={feedback.isPending}
          onClick={() => feedback.mutate({ vote: "up" })}
        >
          <ThumbsUp className={feedbackVote === "up" ? "fill-current" : undefined} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={m.feedback_down()}
          aria-pressed={feedbackVote === "down"}
          className={feedbackVote === "down"
            ? "bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:text-rose-300"
            : undefined}
          disabled={feedback.isPending}
          onClick={() => feedback.mutate({ vote: "down", reason: "irrelevant" })}
        >
          <ThumbsDown className={feedbackVote === "down" ? "fill-current" : undefined} />
        </Button>
      </div>
      {feedbackError ? <p className="mt-1 text-[11px] text-destructive">{feedbackError}</p> : null}
    </article>
  );
}
