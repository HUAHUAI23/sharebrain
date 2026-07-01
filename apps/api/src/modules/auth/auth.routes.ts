import { passwordLoginRequestSchema, passwordRegisterRequestSchema } from "@sharebrain/contracts";
import { OpenAPIHono } from "@hono/zod-openapi";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { parseJson } from "../../app/validation";
import { AuthService } from "./auth.service";

import type { AppEnv } from "../../app/types";
import type { CreatedSession } from "./auth.service";

function setSessionCookie(context: Parameters<typeof setCookie>[0], session: CreatedSession) {
  const env = context.var.env;
  setCookie(context, env.AUTH_SESSION_COOKIE_NAME, session.token, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: env.NODE_ENV === "production",
    expires: session.expiresAt,
  });
}

export function createAuthRoutes() {
  const app = new OpenAPIHono<AppEnv>();

  app.post("/api/auth/register", async (context) => {
    const payload = parseJson(passwordRegisterRequestSchema, await context.req.json());
    const service = new AuthService(context.var.db, context.var.env);
    const session = await service.registerWithPassword(payload);
    setSessionCookie(context, session);
    return context.json(await service.current(session.auth), 201);
  });

  app.post("/api/auth/login", async (context) => {
    const payload = parseJson(passwordLoginRequestSchema, await context.req.json());
    const service = new AuthService(context.var.db, context.var.env);
    const session = await service.loginWithPassword(payload);
    setSessionCookie(context, session);
    return context.json(await service.current(session.auth));
  });

  app.post("/api/auth/logout", async (context) => {
    const service = new AuthService(context.var.db, context.var.env);
    await service.revokeSession(getCookie(context, context.var.env.AUTH_SESSION_COOKIE_NAME));
    deleteCookie(context, context.var.env.AUTH_SESSION_COOKIE_NAME, {
      path: "/",
      secure: context.var.env.NODE_ENV === "production",
    });
    return context.json({ ok: true });
  });

  return app;
}
