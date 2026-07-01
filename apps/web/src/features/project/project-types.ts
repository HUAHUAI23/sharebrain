import type { ProjectModule } from "@sharebrain/contracts";

import type { WorkspaceView } from "../workspace/workspace-types";

export type ModuleViewProps = {
  projectId: string;
  moduleId: string;
  module?: ProjectModule;
  onNavigate: (view: WorkspaceView) => void;
};
