import type { ServerEnv } from "@sharebrain/config";
import type { AuthContext, PasswordLoginRequest, PasswordRegisterRequest } from "@sharebrain/contracts";
import { authAccounts, authSessions, tenantMemberships, tenants, users } from "@sharebrain/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";

import { ApiError } from "../../app/api-error";
import { serializeUser } from "../shared/serializers";
import { createSessionToken, getSessionExpiresAt, hashSessionToken, normalizeEmail } from "./auth-utils";
import { seedTenantModuleTemplates } from "./template-seed.service";

import type { DatabaseClient } from "@sharebrain/db";

export type CreatedSession = {
  token: string;
  expiresAt: Date;
  auth: AuthContext;
  accountId: string | null;
};

export class AuthService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly env: ServerEnv,
  ) {}

  async registerWithPassword(payload: PasswordRegisterRequest): Promise<CreatedSession> {
    if (!this.env.AUTH_PASSWORD_REGISTRATION_ENABLED) {
      throw new ApiError("PASSWORD_REGISTRATION_DISABLED", "当前空间未开放密码注册。", 403);
    }

    const email = normalizeEmail(payload.email);
    const existing = await this.db
      .select({ id: authAccounts.id })
      .from(authAccounts)
      .where(and(eq(authAccounts.provider, "password"), eq(authAccounts.providerAccountId, email), isNull(authAccounts.deletedAt)))
      .limit(1);

    if (existing.length > 0) {
      throw new ApiError("AUTH_ACCOUNT_EXISTS", "该邮箱已注册。", 409);
    }

    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const now = new Date();
    const passwordHash = await Bun.password.hash(payload.password, { algorithm: "argon2id" });

    await this.db.transaction(async (tx) => {
      await tx.insert(tenants).values({
        id: tenantId,
        tenantId,
        name: `${payload.displayName} 的空间`,
        kind: "personal",
        createdBy: userId,
        updatedBy: userId,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(users).values({
        id: userId,
        tenantId,
        email,
        displayName: payload.displayName,
        status: "active",
        createdBy: userId,
        updatedBy: userId,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(tenantMemberships).values({
        tenantId,
        userId,
        role: "admin",
        createdBy: userId,
        updatedBy: userId,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(authAccounts).values({
        id: accountId,
        tenantId,
        userId,
        provider: "password",
        providerAccountId: email,
        passwordHash,
        status: "active",
        createdBy: userId,
        updatedBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    });

    await seedTenantModuleTemplates(this.db, tenantId, userId);
    return this.createSession(userId, tenantId, "admin", accountId);
  }

  async loginWithPassword(payload: PasswordLoginRequest): Promise<CreatedSession> {
    const email = normalizeEmail(payload.email);
    const [account] = await this.db
      .select()
      .from(authAccounts)
      .where(and(eq(authAccounts.provider, "password"), eq(authAccounts.providerAccountId, email), isNull(authAccounts.deletedAt)))
      .limit(1);

    if (!account || account.status !== "active" || !account.passwordHash) {
      throw new ApiError("INVALID_CREDENTIALS", "邮箱或密码不正确。", 401);
    }

    const verified = await Bun.password.verify(payload.password, account.passwordHash);
    if (!verified) {
      throw new ApiError("INVALID_CREDENTIALS", "邮箱或密码不正确。", 401);
    }

    const [membership] = await this.db
      .select()
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, account.tenantId),
          eq(tenantMemberships.userId, account.userId),
          isNull(tenantMemberships.deletedAt),
        ),
      )
      .limit(1);

    if (!membership) {
      throw new ApiError("AUTH_CONTEXT_NOT_FOUND", "账号未绑定可用空间。", 401);
    }

    return this.createSession(account.userId, account.tenantId, membership.role as AuthContext["role"], account.id);
  }

  async resolveSession(token: string | undefined): Promise<(AuthContext & { accountId: string | null }) | null> {
    if (!token) {
      return null;
    }

    const tokenHash = hashSessionToken(token);
    const [session] = await this.db
      .select()
      .from(authSessions)
      .where(
        and(
          eq(authSessions.tokenHash, tokenHash),
          isNull(authSessions.deletedAt),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!session) {
      return null;
    }

    const [membership] = await this.db
      .select()
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, session.tenantId),
          eq(tenantMemberships.userId, session.userId),
          isNull(tenantMemberships.deletedAt),
        ),
      )
      .limit(1);

    if (!membership) {
      return null;
    }

    await this.db
      .update(authSessions)
      .set({ lastSeenAt: new Date(), updatedAt: new Date() })
      .where(eq(authSessions.id, session.id));

    return {
      userId: session.userId,
      tenantId: session.tenantId,
      role: membership.role as AuthContext["role"],
      requestId: crypto.randomUUID(),
      accountId: session.accountId,
    };
  }

  async revokeSession(token: string | undefined) {
    if (!token) {
      return;
    }

    await this.db
      .update(authSessions)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(authSessions.tokenHash, hashSessionToken(token)));
  }

  async current(auth: AuthContext) {
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
      throw new ApiError("AUTH_CONTEXT_NOT_FOUND", "登录上下文不存在或已失效。", 401);
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

  private async createSession(
    userId: string,
    tenantId: string,
    role: AuthContext["role"],
    accountId: string | null,
  ): Promise<CreatedSession> {
    const token = createSessionToken();
    const expiresAt = getSessionExpiresAt(this.env);
    const tokenHash = hashSessionToken(token);
    const now = new Date();

    await this.db.insert(authSessions).values({
      tenantId,
      userId,
      accountId,
      tokenHash,
      expiresAt,
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    return {
      token,
      expiresAt,
      accountId,
      auth: {
        userId,
        tenantId,
        role,
        requestId: crypto.randomUUID(),
      },
    };
  }
}
