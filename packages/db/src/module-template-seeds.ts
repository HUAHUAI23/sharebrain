export type TemplateFieldSeed = {
  id: string;
  key: string;
  label: string;
  type: string;
  required: boolean;
  defaultPolicy: string;
  defaultValue: unknown;
  options: Array<{ id: string; label: string; color?: string }>;
  sortKey: string;
};

export type TemplateSeed = {
  id: string;
  key: string;
  name: string;
  kind: string;
  description: string;
  icon: string;
  sortKey: string;
  fields: TemplateFieldSeed[];
};

export const moduleTemplateSeeds: TemplateSeed[] = [
  {
    id: "00000000-0000-4000-8100-000000000001",
    key: "sealaf",
    name: "sealaf",
    kind: "timeline",
    description: "记录 sealaf 相关交付、变更和问题上下文。",
    icon: "ship-wheel",
    sortKey: "a0",
    fields: [
      {
        id: "00000000-0000-4000-8200-000000000001",
        key: "environment",
        label: "环境",
        type: "text",
        required: false,
        defaultPolicy: "empty",
        defaultValue: null,
        options: [],
        sortKey: "a0",
      },
    ],
  },
  {
    id: "00000000-0000-4000-8100-000000000002",
    key: "aiproxy",
    name: "aiproxy",
    kind: "timeline",
    description: "记录 aiproxy 镜像、配置和发布信息。",
    icon: "boxes",
    sortKey: "b0",
    fields: [
      {
        id: "00000000-0000-4000-8200-000000000002",
        key: "image",
        label: "镜像",
        type: "text",
        required: false,
        defaultPolicy: "empty",
        defaultValue: null,
        options: [],
        sortKey: "a0",
      },
    ],
  },
  {
    id: "00000000-0000-4000-8100-000000000003",
    key: "devbox",
    name: "devbox",
    kind: "timeline",
    description: "记录 devbox 配置、镜像和调试过程。",
    icon: "terminal-square",
    sortKey: "c0",
    fields: [
      {
        id: "00000000-0000-4000-8200-000000000003",
        key: "image",
        label: "镜像",
        type: "text",
        required: false,
        defaultPolicy: "empty",
        defaultValue: null,
        options: [],
        sortKey: "a0",
      },
    ],
  },
];
