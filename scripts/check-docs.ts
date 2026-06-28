const requiredDocs = [
  "docs/architecture.md",
  "docs/project-structure.md",
  "docs/standards/development.md",
  "docs/standards/code-style.md",
  "docs/standards/ui-design.md",
  "docs/standards/ai-development.md",
  "helloagents/project.md",
  "helloagents/wiki/overview.md",
  "helloagents/wiki/arch.md",
  "helloagents/wiki/api.md",
  "helloagents/wiki/data.md",
];

const missing = requiredDocs.filter((path) => !Bun.file(path).exists());

if (missing.length > 0) {
  console.error(`缺少规范文档:\n${missing.map((path) => `- ${path}`).join("\n")}`);
  process.exit(1);
}

console.info(`文档检查通过，共 ${requiredDocs.length} 个关键文档。`);
