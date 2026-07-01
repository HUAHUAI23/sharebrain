import { Button } from "@sharebrain/ui/components/button";
import { m } from "@sharebrain/i18n";
import { Input } from "@sharebrain/ui/components/input";
import { NotionToolbar } from "@sharebrain/ui/components/notion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BasicBlocksPlugin, BasicMarksPlugin } from "@platejs/basic-nodes/react";
import { MarkdownPlugin, markdownToSlateNodes, serializeMd } from "@platejs/markdown";
import { ArrowLeft, FileText, Save } from "lucide-react";
import type { Value } from "platejs";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import { useEffect, useMemo, useState } from "react";

import { apiRequest, queryKeys } from "../../lib/api-client";
import type { DocumentResponse, WorkspaceView } from "../workspace/workspace-types";

const emptyPlateValue: Value = [{ type: "p", children: [{ text: "" }] }];

type EditorShellProps = {
  projectId: string;
  moduleId: string;
  documentId: string;
  recordId?: string;
  onNavigate: (view: WorkspaceView) => void;
};

function plainTextFromMarkdown(markdown: string) {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>#-]/g, "")
    .trim();
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

export function EditorShell({ projectId, moduleId, documentId, recordId, onNavigate }: EditorShellProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [plateValue, setPlateValue] = useState<Value>(emptyPlateValue);
  const document = useQuery({
    queryKey: queryKeys.document(documentId),
    queryFn: () => apiRequest<DocumentResponse>(`/api/documents/${documentId}`),
  });
  const isDirty = useMemo(
    () => title !== (document.data?.title ?? "") || JSON.stringify(plateValue) !== JSON.stringify(document.data?.plateJson ?? []),
    [document.data?.plateJson, document.data?.title, plateValue, title],
  );
  const editor = usePlateEditor(
    {
      plugins: [BasicBlocksPlugin, BasicMarksPlugin, MarkdownPlugin],
      value: plateValue,
    },
    [documentId],
  );
  const save = useMutation({
    mutationFn: () => {
      const markdown = serializeMd(editor);
      return apiRequest(`/api/documents/${documentId}`, {
        method: "PATCH",
        body: {
          title,
          markdown,
          plainText: plainTextFromMarkdown(markdown),
          plateJson: editor.children,
        },
      });
    },
    async onSuccess() {
      await queryClient.invalidateQueries({ queryKey: queryKeys.document(documentId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents(projectId, moduleId, recordId) });
    },
  });

  useEffect(() => {
    if (document.data) {
      setTitle(document.data.title);
      if (document.data.markdown) {
        const nextValue = toPlateValue(markdownToSlateNodes(editor, document.data.markdown));
        setPlateValue(nextValue);
        editor.tf.setValue(nextValue);
      } else {
        const nextValue = toPlateValue(document.data.plateJson);
        setPlateValue(nextValue);
        editor.tf.setValue(nextValue);
      }
    }
  }, [document.data, editor]);

  return (
    <main className="editor-page">
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
        <Button size="sm" variant={isDirty ? "default" : "ghost"} disabled={!isDirty || save.isPending} onClick={() => save.mutate()}>
          <Save size={14} />
          {m.common_save()}
        </Button>
      </NotionToolbar>
      <article className="markdown-editor">
        <Input value={title} onChange={(event) => setTitle(event.target.value)} aria-label={m.module_document_title_aria()} className="title-input" />
        <Plate editor={editor} onValueChange={({ value }) => setPlateValue(toPlateValue(value))}>
          <PlateContent className="plate-content" placeholder={m.document_editor_placeholder()} />
        </Plate>
      </article>
    </main>
  );
}
