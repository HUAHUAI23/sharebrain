import { type AuthContext } from "@sharebrain/contracts";
import { tenants, users } from "@sharebrain/db/schema";
import { and, eq, isNull } from "drizzle-orm";

import { ApiError } from "../../app/api-error";
import { serializeUser } from "../shared/serializers";

import type { DatabaseClient } from "@sharebrain/db";

export class MeService {
  constructor(private readonly db: DatabaseClient) {}

  async getCurrent(auth: AuthContext) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, auth.userId), eq(users.tenantId, auth.tenantId), isNull(users.deletedAt)))
      .limit(1);

    const [tenant] = await this.db
      .select()
      .from(tenants)
      .where(and(eq(tenants.id, auth.tenantId), isNull(tenants.deletedAt)))
      .limit(1);

    if (!user || !tenant) {
      throw new ApiError("AUTH_CONTEXT_NOT_FOUND", "开发用户或空间不存在，请先运行 db:seed。", 401);
    }

    return {
      user: serializeUser(user),
      tenant: {
        id: tenant.id,
        name: tenant.name,
        kind: tenant.kind as "personal" | "team",
      },
      role: auth.role,
    };
  }
}
