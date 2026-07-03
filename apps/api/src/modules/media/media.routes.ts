import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { parseJson } from "../../app/validation";
import type { AppEnv } from "../../app/types";
import { MediaService } from "./media.service";

const avatarRequestSchema = z.object({
  mediaId: z.string().uuid(),
});

export function createMediaRoutes() {
  const app = new OpenAPIHono<AppEnv>();

  app.post("/api/media/uploads", async (context) => {
    const service = new MediaService(context.var.db, context.var.env);
    return context.json(await service.createUpload(context.var.auth, await context.req.json()), 201);
  });

  app.post("/api/media/uploads/:uploadId/complete", async (context) => {
    const service = new MediaService(context.var.db, context.var.env);
    return context.json(await service.completeUpload(context.var.auth, context.req.param("uploadId"), await context.req.json()));
  });

  app.get("/api/media/:mediaId/url", async (context) => {
    const service = new MediaService(context.var.db, context.var.env);
    return context.json(await service.createReadUrl(context.var.auth, context.req.param("mediaId")));
  });

  // 文档内嵌媒体的稳定地址：预签名读取 URL 会过期，编辑器把该地址写入文档，
  // 每次访问时重定向到新签发的读取 URL。
  app.get("/api/media/:mediaId/raw", async (context) => {
    const service = new MediaService(context.var.db, context.var.env);
    const { url } = await service.createReadUrl(context.var.auth, context.req.param("mediaId"));
    return context.redirect(url, 302);
  });

  app.patch("/api/me/avatar", async (context) => {
    const service = new MediaService(context.var.db, context.var.env);
    const payload = parseJson(avatarRequestSchema, await context.req.json());
    return context.json(await service.attachAvatar(context.var.auth, payload.mediaId));
  });

  return app;
}
