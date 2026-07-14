// 编排 API operation、collab 执行与 acknowledgement 丢失后的 status fallback。
import type { DocumentVersionOperation } from "@sharebrain/contracts";
import type { HocuspocusProviderWrapper } from "@platejs/yjs";

import { apiRequest } from "../../lib/api-client";
import { executeCollabVersionOperation } from "./editor-collab-provider";

const terminalStatuses = new Set(["applied", "conflict", "failed", "expired"]);

export type DocumentHistoryRestoreSource =
  | { kind: "version"; id: string }
  | { kind: "activity"; id: string };

export async function restoreDocumentHistorySource(input: {
  documentId: string;
  source: DocumentHistoryRestoreSource;
  baseStateVector: string;
  provider: HocuspocusProviderWrapper;
  force?: boolean;
}) {
  const sourcePath = input.source.kind === "version"
    ? `versions/${input.source.id}`
    : `activities/${input.source.id}`;
  const operation = await apiRequest<DocumentVersionOperation>(
    `/api/documents/${input.documentId}/${sourcePath}/restore-operations`,
    {
      method: "POST",
      body: {
        requestId: crypto.randomUUID(),
        baseStateVector: input.baseStateVector,
        force: input.force ?? false,
      },
    },
  );

  try {
    const ack = await executeCollabVersionOperation(input.provider, operation.operationId);
    if (terminalStatuses.has(ack.status)) {
      return { ...operation, ...ack } satisfies DocumentVersionOperation;
    }
  } catch {
    // acknowledgement 丢失不代表执行失败，统一由持久化 status 收敛结果。
  }

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const status = await apiRequest<DocumentVersionOperation>(
      `/api/documents/${input.documentId}/version-operations/${operation.operationId}`,
    );
    if (terminalStatuses.has(status.status)) return status;
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw new Error("DOCUMENT_VERSION_OPERATION_STATUS_TIMEOUT");
}

export function restoreDocumentVersion(
  input: Omit<Parameters<typeof restoreDocumentHistorySource>[0], "source"> & {
    versionId: string;
  },
) {
  return restoreDocumentHistorySource({
    ...input,
    source: { kind: "version", id: input.versionId },
  });
}
