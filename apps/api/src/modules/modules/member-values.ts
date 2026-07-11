// 统一动态 user 字段的成员事实源，候选列表和写入校验都要求 active membership + active user。
import type { AuthContext } from "@sharebrain/contracts";
import { tenantMemberships, users } from "@sharebrain/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { ApiError } from "../../app/api-error";

import type { DatabaseClient } from "@sharebrain/db";

export async function ensureActiveMemberValues(
  db: DatabaseClient,
  auth: AuthContext,
  fields: Array<{ id: string; type: string }>,
  values: Record<string, unknown>,
) {
  const memberIds = [
    ...new Set(
      fields
        .filter((field) => field.type === "user")
        .map((field) => values[field.id])
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  ];
  if (memberIds.length === 0) return;

  const memberships = await db
    .select({ userId: tenantMemberships.userId })
    .from(tenantMemberships)
    .innerJoin(
      users,
      and(
        eq(tenantMemberships.userId, users.id),
        eq(tenantMemberships.tenantId, users.tenantId),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    )
    .where(
      and(
        eq(tenantMemberships.tenantId, auth.tenantId),
        inArray(tenantMemberships.userId, memberIds),
        isNull(tenantMemberships.deletedAt),
      ),
    );
  if (memberships.length !== memberIds.length) {
    throw new ApiError("FIELD_USER_INVALID", "用户字段必须选择当前空间的有效成员。", 422);
  }
}
