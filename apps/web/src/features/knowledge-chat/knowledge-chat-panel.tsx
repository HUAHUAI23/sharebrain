// 渲染跨路由常驻的知识聊天面板、会话历史、引用解释与反馈交互。
import type {
  AiCitation,
  AiConversation,
  AiFeedback,
  AiMessage,
  KnowledgeScope,
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
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import {
  Bot,
  ChevronLeft,
  ExternalLink,
  File,
  History,
  MessageSquareText,
  PanelRightClose,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { apiRequest, queryKeys } from "../../lib/api-client";
import { runtimeEnv } from "../../lib/runtime-env";
import { retryKnowledgeChat, streamKnowledgeChat } from "./knowledge-chat.client";
import { uploadKnowledgeChatAttachment } from "./knowledge-chat-attachment";
import { useKnowledgeChatStore } from "./knowledge-chat.store";

type ConversationsResponse = { items: AiConversation[]; nextCursor: string | null };
type MessagesResponse = { items: AiMessage[]; nextCursor: string | null };
type OptimisticTurn = {
  userText: string;
  assistantText: string;
  citations: AiCitation[];
  scope: KnowledgeScope | null;
  attachments: AttachmentDraft[];
};
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
};

export function KnowledgeChatPanel() {
  const isMobile = useIsMobile();
  const matchRoute = useMatchRoute();
  const projectMatch = matchRoute({ to: "/projects/$projectId", fuzzy: true });
  const activeProjectId = projectMatch ? projectMatch.projectId : null;
  const open = useKnowledgeChatStore((state) => state.open);
  const setOpen = useKnowledgeChatStore((state) => state.setOpen);
  const toggleOpen = useKnowledgeChatStore((state) => state.toggleOpen);

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
        <aside className="fixed top-3 right-3 bottom-3 z-40 w-[min(410px,calc(100vw-24px))] overflow-hidden rounded-md border border-border bg-background shadow-xl">
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
  const selectConversation = useKnowledgeChatStore((state) => state.selectConversation);
  const showConversations = useKnowledgeChatStore((state) => state.showConversations);
  const setShowConversations = useKnowledgeChatStore((state) => state.setShowConversations);
  const [draft, setDraft] = useState("");
  const [includeCrossProject, setIncludeCrossProject] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<OptimisticTurn | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingScopeChoice, setPendingScopeChoice] = useState<PendingScopeChoice | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);

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
  const project = useQuery({
    queryKey: queryKeys.project(activeProjectId ?? "global"),
    queryFn: () => apiRequest<{ id: string; name: string }>(`/api/projects/${activeProjectId}`),
    enabled: Boolean(activeProjectId),
  });

  useEffect(() => {
    const firstConversation = conversations.data?.pages[0]?.items[0];
    if (!selectedConversationId && !optimistic && firstConversation) {
      selectConversation(firstConversation.id);
    }
  }, [conversations.data?.pages, optimistic, selectConversation, selectedConversationId]);

  useEffect(() => () => abortRef.current?.abort(), []);

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
    const startedAt = Date.now();
    const readyAttachments = attachments.filter((attachment) =>
      attachment.status === "ready" && attachment.mediaObjectId);
    setStreaming(true);
    setStreamError(null);
    setOptimistic({
      userText: message,
      assistantText: "",
      citations: [],
      scope: null,
      attachments: readyAttachments,
    });
    setAttachments([]);
    const controller = new AbortController();
    abortRef.current = controller;
    let customError: string | null = null;
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
        onScope(scope) {
          setOptimistic((current) => current ? { ...current, scope } : current);
        },
        onCitations(citations) {
          setOptimistic((current) => current ? { ...current, citations } : current);
        },
        onText(delta) {
          setOptimistic((current) => current
            ? { ...current, assistantText: current.assistantText + delta }
            : current);
        },
        onError(error) {
          customError = error.message;
          setStreamError(error.message);
        },
      }, controller.signal);
      if (!customError) setOptimistic(null);
    } catch (error) {
      if (!controller.signal.aborted) {
        setStreamError(error instanceof Error ? error.message : m.chat_error());
      }
    } finally {
      await queryClient.invalidateQueries({ queryKey: queryKeys.aiConversations });
      if (selectedConversationId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.aiMessages(selectedConversationId) });
        setOptimistic(null);
      } else {
        try {
          const latest = await apiRequest<ConversationsResponse>("/api/ai/conversations?limit=1");
          const candidate = latest.items[0];
          const conversationId = candidate && Date.parse(candidate.updatedAt) >= startedAt - 1_000
            ? candidate.id
            : null;
          if (conversationId) {
            selectConversation(conversationId);
            await queryClient.invalidateQueries({ queryKey: queryKeys.aiMessages(conversationId) });
            setOptimistic(null);
          }
        } catch {
          // 保留本地流结果，下一次成功刷新会以 REST 历史替换它。
        }
      }
      abortRef.current = null;
      setStreaming(false);
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

  const addAttachments = (files: FileList | null) => {
    if (!files) return;
    const available = Math.max(0, 8 - attachments.length);
    for (const file of Array.from(files).slice(0, available)) {
      const localId = crypto.randomUUID();
      const draft: AttachmentDraft = {
        localId,
        mediaObjectId: null,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        byteSize: file.size,
        progress: 0,
        status: "uploading",
      };
      setAttachments((current) => [...current, draft]);
      void uploadKnowledgeChatAttachment(file, (progress) => {
        setAttachments((current) => current.map((item) =>
          item.localId === localId ? { ...item, progress } : item));
      }).then((media) => {
        setAttachments((current) => current.map((item) => item.localId === localId
          ? { ...item, mediaObjectId: media.id, progress: 100, status: "ready" }
          : item));
      }).catch(() => {
        setAttachments((current) => current.map((item) => item.localId === localId
          ? { ...item, status: "failed" }
          : item));
      });
    }
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
  };

  return (
    <>
    <div className="grid h-full min-h-0 grid-rows-[52px_minmax(0,1fr)_auto] bg-background">
      <header className="flex min-w-0 items-center gap-1 border-b border-border px-3">
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
        ) : (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
            <Bot className="size-4" />
          </span>
        )}
        <div className="min-w-0 flex-1 px-1">
          <h2 className="truncate text-[13px] font-semibold">
            {showConversations ? m.chat_conversations() : m.chat_title()}
          </h2>
          {!showConversations ? (
            <p className="truncate text-[11px] text-muted-foreground">
              {activeProjectId ? project.data?.name ?? m.chat_scope_project() : m.chat_scope_global()}
            </p>
          ) : null}
        </div>
        {!showConversations ? (
          <>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={m.chat_new()} onClick={() => selectConversation(null)}>
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
          onSelect={selectConversation}
          onDelete={setPendingDeleteId}
          onLoadMore={() => void conversations.fetchNextPage()}
        />
      ) : (
        <MessageList
          messages={[...(messages.data?.pages ?? [])].reverse().flatMap((page) => page.items)}
          loading={messages.isLoading}
          optimistic={optimistic}
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
                    <File className="size-3.5 shrink-0" />
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
                      onClick={() => setAttachments((current) =>
                        current.filter((item) => item.localId !== attachment.localId))}
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
              <Button
                type="button"
                size="icon-sm"
                disabled={!draft.trim() || streaming || attachments.some((item) => item.status === "uploading")}
                aria-label={m.chat_send()}
                onClick={() => void send()}
              >
                <Send />
              </Button>
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
  hasOlder,
  loadingOlder,
  onLoadOlder,
}: {
  messages: AiMessage[];
  loading: boolean;
  optimistic: OptimisticTurn | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => Promise<unknown>;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const latestSequence = messages.at(-1)?.sequence ?? null;
  const previousLatestSequence = useRef<number | null>(null);
  useEffect(() => {
    if (
      previousLatestSequence.current === null ||
      previousLatestSequence.current !== latestSequence ||
      optimistic
    ) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
    previousLatestSequence.current = latestSequence;
  }, [latestSequence, optimistic, optimistic?.assistantText]);
  const loadOlder = async () => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>("[data-slot='scroll-area-viewport']");
    const previousHeight = viewport?.scrollHeight ?? 0;
    const previousTop = viewport?.scrollTop ?? 0;
    await onLoadOlder();
    requestAnimationFrame(() => {
      if (viewport) viewport.scrollTop = previousTop + viewport.scrollHeight - previousHeight;
    });
  };
  return (
    <ScrollArea ref={scrollAreaRef} className="min-h-0">
      <div className="mx-auto grid w-full max-w-[680px] gap-5 p-4">
        {hasOlder ? (
          <Button type="button" size="sm" variant="ghost" disabled={loadingOlder} onClick={() => void loadOlder()}>
            {loadingOlder ? m.common_loading() : m.chat_load_older()}
          </Button>
        ) : null}
        {loading ? <p className="py-10 text-center text-sm text-muted-foreground">{m.common_loading()}</p> : null}
        {!loading && messages.length === 0 && !optimistic ? (
          <div className="grid min-h-72 place-content-center gap-3 text-center">
            <span className="mx-auto flex size-10 items-center justify-center rounded-md border border-border bg-muted/50">
              <Bot className="size-5" />
            </span>
            <p className="text-sm font-medium">{m.chat_empty_title()}</p>
          </div>
        ) : null}
        {messages.map((message) => <ChatMessage key={message.id} message={message} />)}
        {optimistic ? (
          <>
            <ChatText role="user" text={optimistic.userText} attachments={optimistic.attachments} />
            <ChatText
              role="assistant"
              text={optimistic.assistantText || m.chat_thinking()}
              citations={optimistic.citations}
              scope={optimistic.scope}
            />
          </>
        ) : null}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}

function ChatMessage({ message }: { message: AiMessage }) {
  const queryClient = useQueryClient();
  const [retryText, setRetryText] = useState<string | null>(null);
  const [retryCitations, setRetryCitations] = useState<AiCitation[]>(message.citations);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const retryAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => retryAbortRef.current?.abort(), []);
  const text = message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
  const error = message.parts.find((part) => part.type === "error");
  const attachments = message.parts.filter((part): part is Extract<AiMessage["parts"][number], { type: "attachment" }> =>
    part.type === "attachment");
  const retry = async () => {
    if (!message.runId || retrying) return;
    const controller = new AbortController();
    retryAbortRef.current = controller;
    setRetrying(true);
    setRetryText("");
    setRetryCitations([]);
    setRetryError(null);
    let streamFailed = false;
    try {
      await retryKnowledgeChat(message.runId, {
        onCitations(citations) {
          setRetryCitations(citations);
        },
        onText(delta) {
          setRetryText((current) => (current ?? "") + delta);
        },
        onError(streamError) {
          streamFailed = true;
          setRetryError(streamError.message);
        },
      }, controller.signal);
      await queryClient.invalidateQueries({ queryKey: queryKeys.aiMessages(message.conversationId) });
      if (!streamFailed) setRetryText(null);
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
      text={retryText !== null
        ? retryText || m.chat_retrying()
        : text || (error?.type === "error" ? error.message : "")}
      citations={retryText !== null ? retryCitations : message.citations}
      failed={message.status === "failed" && retryText === null}
      retrying={retrying}
      retryError={retryError}
      attachments={attachments.map((attachment) => ({
        localId: attachment.mediaObjectId,
        mediaObjectId: attachment.mediaObjectId,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        byteSize: attachment.byteSize,
        progress: 100,
        status: "ready",
      }))}
      {...(message.runId && message.status === "failed" ? { onRetry: () => void retry() } : {})}
    />
  );
}

function ChatText({
  messageId,
  role,
  text,
  citations = [],
  scope,
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
  failed?: boolean;
  retrying?: boolean;
  retryError?: string | null;
  onRetry?: () => void;
  attachments?: AttachmentDraft[];
}) {
  const feedback = useMutation({
    mutationFn: (value: AiFeedback) => apiRequest<{ ok: boolean }>(
      `/api/ai/messages/${messageId}/feedback`,
      { method: "POST", body: value },
    ),
  });
  if (role === "user") {
    return (
      <div className="ml-auto grid max-w-[88%] gap-2 rounded-md bg-muted px-3 py-2 text-[13px] leading-6 whitespace-pre-wrap break-words">
        <span>{text}</span>
        {attachments.map((attachment) => (
          <a
            key={attachment.localId}
            className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            href={attachment.mediaObjectId
              ? `${runtimeEnv.WEB_PUBLIC_API_BASE_URL}/api/media/${attachment.mediaObjectId}/raw`
              : undefined}
            target="_blank"
            rel="noreferrer"
          >
            <File className="size-3.5 shrink-0" />
            <span className="truncate">{attachment.fileName}</span>
          </a>
        ))}
      </div>
    );
  }
  return (
    <article className="min-w-0">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
          <Bot className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-6 whitespace-pre-wrap break-words">{text}</p>
          {failed ? <p className="mt-1 text-xs text-destructive">{m.chat_failed()}</p> : null}
        </div>
      </div>
      {scope ? (
        <p className="mt-2 ml-8 text-[10px] leading-4 text-muted-foreground">
          {scope.ambiguousProjects.length > 1
            ? m.chat_scope_ambiguous({ count: scope.ambiguousProjects.length })
            : m.chat_scope_resolved({ name: scope.projectName ?? m.chat_scope_global() })}
        </p>
      ) : null}
      {citations.length > 0 ? <CitationList citations={citations} /> : null}
      {retryError ? <p className="mt-2 ml-8 text-xs text-destructive">{retryError}</p> : null}
      {messageId || onRetry ? (
        <div className="mt-2 ml-8 flex items-center gap-1">
          {onRetry ? (
            <Button type="button" variant="ghost" size="sm" disabled={retrying} onClick={onRetry}>
              <RotateCcw />
              {m.common_retry()}
            </Button>
          ) : null}
          {messageId ? (
            <>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={m.feedback_up()} onClick={() => feedback.mutate({ vote: "up" })}>
            <ThumbsUp />
          </Button>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={m.feedback_down()} onClick={() => feedback.mutate({ vote: "down" })}>
            <ThumbsDown />
          </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function CitationList({ citations }: { citations: AiCitation[] }) {
  const projects = new Set(citations.map((citation) => citation.projectId));
  return (
    <details className="mt-3 ml-8 rounded-md border border-border bg-muted/20">
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
  const feedback = useMutation({
    mutationFn: (value: AiFeedback) => apiRequest<{ ok: boolean }>(
      `/api/ai/citations/${citation.id}/feedback`,
      { method: "POST", body: value },
    ),
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
        <Button type="button" variant="ghost" size="icon-xs" aria-label={m.feedback_up()} onClick={() => feedback.mutate({ vote: "up" })}>
          <ThumbsUp />
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={m.feedback_down()} onClick={() => feedback.mutate({ vote: "down", reason: "irrelevant" })}>
          <ThumbsDown />
        </Button>
      </div>
    </article>
  );
}
