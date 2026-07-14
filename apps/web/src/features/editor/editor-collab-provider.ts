// 从 Plate Yjs 获取唯一 Hocuspocus provider，并关联 stateless operation acknowledgement。
import { HocuspocusProviderWrapper } from "@platejs/yjs";
import { YjsPlugin } from "@platejs/yjs/react";
import { documentVersionOperationAckSchema, type DocumentVersionOperationAck } from "@sharebrain/contracts";
import type { PlateEditor } from "platejs/react";
import * as Y from "yjs";

export function getEditorCollabProvider(editor: PlateEditor) {
  return editor
    .getOptions(YjsPlugin)
    ._providers.find(
      (provider): provider is HocuspocusProviderWrapper =>
        provider instanceof HocuspocusProviderWrapper,
    ) ?? null;
}

export function encodeDocumentStateVector(ydoc: Y.Doc) {
  const bytes = Y.encodeStateVector(ydoc);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function executeCollabVersionOperation(
  wrapper: HocuspocusProviderWrapper,
  operationId: string,
  timeoutMs = 8_000,
) {
  return new Promise<DocumentVersionOperationAck>((resolve, reject) => {
    const onStateless = ({ payload }: { payload: string }) => {
      const parsed = documentVersionOperationAckSchema.safeParse(JSON.parse(payload));
      if (!parsed.success || parsed.data.operationId !== operationId) return;
      cleanup();
      resolve(parsed.data);
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("DOCUMENT_VERSION_OPERATION_ACK_TIMEOUT"));
    }, timeoutMs);
    const cleanup = () => {
      window.clearTimeout(timeout);
      wrapper.provider.off("stateless", onStateless);
    };

    wrapper.provider.on("stateless", onStateless);
    wrapper.provider.sendStateless(
      JSON.stringify({ type: "document.version.operation.execute", operationId }),
    );
  });
}
