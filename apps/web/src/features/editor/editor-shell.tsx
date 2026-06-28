import { Button } from "@sharebrain/ui/components/button";
import { Surface } from "@sharebrain/ui/components/surface";
import { Bold, FileText, Heading1, Italic, List, MoreHorizontal, WandSparkles } from "lucide-react";

export function EditorShell() {
  return (
    <Surface className="editor-shell">
      <div className="editor-toolbar" aria-label="编辑器工具栏">
        <Button size="sm" variant="ghost">
          <Heading1 size={16} />
          Text
        </Button>
        <Button size="icon" variant="ghost" aria-label="加粗">
          <Bold size={16} />
        </Button>
        <Button size="icon" variant="ghost" aria-label="斜体">
          <Italic size={16} />
        </Button>
        <Button size="icon" variant="ghost" aria-label="列表">
          <List size={16} />
        </Button>
        <Button size="sm" variant="secondary">
          <WandSparkles size={15} />
          AI
        </Button>
        <Button size="icon" variant="ghost" aria-label="更多">
          <MoreHorizontal size={16} />
        </Button>
      </div>
      <div className="editor-canvas">
        <div className="document-icon">
          <FileText size={34} />
        </div>
        <p className="editor-kicker">Project Context</p>
        <h1>客户私有化项目复盘</h1>
        <p>
          这里是 Plate 编辑器挂载区域。当前阶段保留编辑器、协作、AI 插件依赖和 UI
          边界，后续业务阶段再接入真实文档模型、Yjs provider 与权限。
        </p>
      </div>
    </Surface>
  );
}
