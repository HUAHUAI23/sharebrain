// 集中定义知识检索与引用读取的项目可见性边界，后续项目 ACL 只需替换此处。
import type { AuthContext } from "@sharebrain/contracts";
import type { DatabaseClient } from "@sharebrain/db";
import { projectRecents, projects } from "@sharebrain/db/schema";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { ApiError } from "../../app/api-error";

export type VisibleProject = {
  id: string;
  name: string;
};

export async function visibleProjects(
  db: DatabaseClient,
  auth: AuthContext,
): Promise<VisibleProject[]> {
  return db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.tenantId, auth.tenantId), isNull(projects.deletedAt)));
}

export async function visibleProjectIds(db: DatabaseClient, auth: AuthContext) {
  return (await visibleProjects(db, auth)).map((project) => project.id);
}

export async function requireVisibleProject(
  db: DatabaseClient,
  auth: AuthContext,
  projectId: string,
) {
  const [project] = await db
    .select({ id: projects.id, name: projects.name })
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
    throw new ApiError("PROJECT_NOT_FOUND", "项目不存在或不可访问。", 404);
  }
  return project;
}

export async function mostRecentVisibleProject(
  db: DatabaseClient,
  auth: AuthContext,
  visibleIds: string[],
) {
  if (visibleIds.length === 0) return null;
  const [recent] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projectRecents)
    .innerJoin(projects, eq(projectRecents.projectId, projects.id))
    .where(
      and(
        eq(projectRecents.tenantId, auth.tenantId),
        eq(projectRecents.userId, auth.userId),
        inArray(projectRecents.projectId, visibleIds),
        isNull(projectRecents.deletedAt),
        isNull(projects.deletedAt),
      ),
    )
    .orderBy(desc(projectRecents.lastViewedAt))
    .limit(1);
  return recent ?? null;
}
