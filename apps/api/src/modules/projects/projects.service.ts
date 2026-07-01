import {
  createProjectRequestSchema,
  updateProjectRequestSchema,
  type AuthContext,
} from "@sharebrain/contracts";
import {
  moduleTemplateFields,
  moduleTemplates,
  projectModuleFields,
  projectModules,
  projectRecents,
  projects,
} from "@sharebrain/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";

import { ApiError } from "../../app/api-error";
import { parseJson } from "../../app/validation";
import { serializeProject, serializeProjectRecent } from "../shared/serializers";

import type { DatabaseClient } from "@sharebrain/db";

export class ProjectsService {
  constructor(private readonly db: DatabaseClient) {}

  async list(auth: AuthContext) {
    const rows = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.tenantId, auth.tenantId), isNull(projects.deletedAt)))
      .orderBy(desc(projects.updatedAt));

    return rows.map(serializeProject);
  }

  async listRecents(auth: AuthContext) {
    const rows = await this.db
      .select({ project: projects, recent: projectRecents })
      .from(projectRecents)
      .innerJoin(projects, eq(projectRecents.projectId, projects.id))
      .where(
        and(
          eq(projectRecents.tenantId, auth.tenantId),
          eq(projectRecents.userId, auth.userId),
          isNull(projects.deletedAt),
        ),
      )
      .orderBy(desc(projectRecents.lastViewedAt))
      .limit(12);

    return rows.map((row) => serializeProjectRecent(row.project, row.recent));
  }

  async get(auth: AuthContext, projectId: string) {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, auth.tenantId), isNull(projects.deletedAt)))
      .limit(1);

    if (!project) {
      throw new ApiError("PROJECT_NOT_FOUND", "项目不存在。", 404);
    }

    await this.touchRecent(auth, project.id);
    return serializeProject(project);
  }

  async create(auth: AuthContext, input: unknown) {
    const payload = parseJson(createProjectRequestSchema, input);
    const now = new Date();
    const [created] = await this.db.transaction(async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({
          tenantId: auth.tenantId,
          name: payload.name,
          description: payload.description ?? null,
          ownerId: auth.userId,
          status: "active",
          tags: [],
          createdBy: auth.userId,
          updatedBy: auth.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!project) {
        throw new ApiError("PROJECT_CREATE_FAILED", "项目创建失败。", 500);
      }

      const templates = await tx
        .select()
        .from(moduleTemplates)
        .where(and(eq(moduleTemplates.tenantId, auth.tenantId), isNull(moduleTemplates.deletedAt)))
        .orderBy(moduleTemplates.sortKey);

      for (const template of templates) {
        const [module] = await tx
          .insert(projectModules)
          .values({
            tenantId: auth.tenantId,
            projectId: project.id,
            sourceTemplateId: template.id,
            key: template.key,
            name: template.name,
            kind: template.kind,
            description: template.description,
            icon: template.icon,
            sortKey: template.sortKey,
            createdBy: auth.userId,
            updatedBy: auth.userId,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        if (!module) {
          throw new ApiError("MODULE_CREATE_FAILED", "项目模块创建失败。", 500);
        }

        const fields = await tx
          .select()
          .from(moduleTemplateFields)
          .where(and(eq(moduleTemplateFields.tenantId, auth.tenantId), eq(moduleTemplateFields.templateId, template.id), isNull(moduleTemplateFields.deletedAt)))
          .orderBy(moduleTemplateFields.sortKey);

        for (const field of fields) {
          await tx.insert(projectModuleFields).values({
            tenantId: auth.tenantId,
            moduleId: module.id,
            key: field.key,
            label: field.label,
            type: field.type,
            required: field.required,
            defaultPolicy: field.defaultPolicy,
            defaultValue: field.defaultValue,
            options: field.options,
            sortKey: field.sortKey,
            createdBy: auth.userId,
            updatedBy: auth.userId,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      await tx.insert(projectRecents).values({
        tenantId: auth.tenantId,
        userId: auth.userId,
        projectId: project.id,
        lastViewedAt: now,
        createdBy: auth.userId,
        updatedBy: auth.userId,
        createdAt: now,
        updatedAt: now,
      });

      return [project];
    });

    return serializeProject(created);
  }

  async update(auth: AuthContext, projectId: string, input: unknown) {
    const payload = parseJson(updateProjectRequestSchema, input);
    const [project] = await this.db
      .update(projects)
      .set({
        ...payload,
        updatedBy: auth.userId,
        updatedAt: new Date(),
      })
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, auth.tenantId), isNull(projects.deletedAt)))
      .returning();

    if (!project) {
      throw new ApiError("PROJECT_NOT_FOUND", "项目不存在。", 404);
    }

    return serializeProject(project);
  }

  async softDelete(auth: AuthContext, projectId: string) {
    const [project] = await this.db
      .update(projects)
      .set({ deletedAt: new Date(), updatedBy: auth.userId, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, auth.tenantId), isNull(projects.deletedAt)))
      .returning();

    if (!project) {
      throw new ApiError("PROJECT_NOT_FOUND", "项目不存在。", 404);
    }

    return serializeProject(project);
  }

  async restore(auth: AuthContext, projectId: string) {
    const [project] = await this.db
      .update(projects)
      .set({ deletedAt: null, updatedBy: auth.userId, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, auth.tenantId)))
      .returning();

    if (!project) {
      throw new ApiError("PROJECT_NOT_FOUND", "项目不存在。", 404);
    }

    return serializeProject(project);
  }

  async touchRecent(auth: AuthContext, projectId: string) {
    const now = new Date();
    await this.db
      .insert(projectRecents)
      .values({
        tenantId: auth.tenantId,
        userId: auth.userId,
        projectId,
        lastViewedAt: now,
        createdBy: auth.userId,
        updatedBy: auth.userId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [projectRecents.userId, projectRecents.projectId],
        set: {
          lastViewedAt: now,
          updatedBy: auth.userId,
          updatedAt: now,
        },
      });
  }
}
