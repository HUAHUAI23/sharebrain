// 定义新项目配置编辑器与 API mutation 之间的稳定 payload 边界。
import type {
  FieldDefaultKind,
  ModuleFieldOption,
  ModuleFieldType,
} from "@sharebrain/contracts";

export type TemplateUpdatePayload = {
  key?: string;
  name?: string;
  description?: string;
  icon?: string;
  includedInNewProjects?: boolean;
};

export type FieldPayload = {
  id?: string;
  key: string;
  label: string;
  type: ModuleFieldType;
  required: boolean;
  defaultKind: FieldDefaultKind;
  defaultValue?: unknown;
  options: ModuleFieldOption[];
};
