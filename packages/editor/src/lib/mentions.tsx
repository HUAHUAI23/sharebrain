import * as React from 'react';

export type EditorMentionItem = {
  /** Unique identifier of the mentionable entity. */
  key: string;
  /** Text shown in the combobox and inserted into the document. */
  text: string;
};

const EditorMentionContext = React.createContext<EditorMentionItem[]>([]);

/**
 * Injects the host application's mentionable items (members, documents, ...)
 * into the editor. Without a provider the mention combobox is empty.
 */
export function EditorMentionProvider({
  children,
  items,
}: React.PropsWithChildren<{ items: EditorMentionItem[] }>) {
  return (
    <EditorMentionContext.Provider value={items}>
      {children}
    </EditorMentionContext.Provider>
  );
}

export function useMentionItems() {
  return React.useContext(EditorMentionContext);
}
