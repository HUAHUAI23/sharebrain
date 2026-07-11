// 封装项目模块领域共享的权限与归属检查，保持各 service 的查询边界一致。
import type { AuthContext } from "@sharebrain/contracts";
import { moduleTemplates, projectModules, projects } from "@sharebrain/db/schema";
import { and, eq, isNull } from "drizzle-orm";

import { ApiError } from "../../app/api-error";

import type { DatabaseClient } from "@sharebrain/db";

export function assertModuleAdmin(auth: AuthContext) {
  if (auth.role !== "admin") {
    throw new ApiError("FORBIDDEN", "当前账号没有管理空间模块的权限。", 403);
  }
}

export function assertModuleEditor(auth: AuthContext) {
  if (auth.role === "viewer" || auth.role === "auditor") {
    throw new ApiError("FORBIDDEN", "当前账号没有编辑权限。", 403);
  }
}

export async function ensureProject(db: DatabaseClient, auth: AuthContext, projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.tenantId, auth.tenantId),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);
  if (!project) {
    throw new ApiError("PROJECT_NOT_FOUND", "项目不存在。", 404);
  }
  return project;
}

export async function ensureProjectModule(db: DatabaseClient, auth: AuthContext, moduleId: string) {
  const [module] = await db
    .select()
    .from(projectModules)
    .where(
      and(
        eq(projectModules.id, moduleId),
        eq(projectModules.tenantId, auth.tenantId),
        isNull(projectModules.deletedAt),
      ),
    )
    .limit(1);
  if (!module) {
    throw new ApiError("MODULE_NOT_FOUND", "模块不存在。", 404);
  }
  return module;
}

export function assertModuleInProject(
  module: typeof projectModules.$inferSelect,
  projectId: string,
) {
  if (module.projectId !== projectId) {
    throw new ApiError("MODULE_PROJECT_MISMATCH", "模块不属于当前项目。", 404);
  }
}

export async function isProjectModuleFixed(
  db: DatabaseClient,
  auth: AuthContext,
  module: typeof projectModules.$inferSelect,
) {
  if (!module.sourceTemplateId) return false;

  const [template] = await db
    .select({ sourceSystemTemplateId: moduleTemplates.sourceSystemTemplateId })
    .from(moduleTemplates)
    .where(
      and(
        eq(moduleTemplates.id, module.sourceTemplateId),
        eq(moduleTemplates.tenantId, auth.tenantId),
        isNull(moduleTemplates.deletedAt),
      ),
    )
    .limit(1);
  return template?.sourceSystemTemplateId !== null && template?.sourceSystemTemplateId !== undefined;
}
