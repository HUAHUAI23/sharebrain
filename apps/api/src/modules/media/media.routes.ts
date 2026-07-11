import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../app/types";
import { GENERATED_AVATAR_VERSION, renderGeneratedAvatar } from "./avatar-renderer";
import { MediaService } from "./media.service";

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
    // 重定向目标带短期签名，禁止浏览器/中间层缓存本次跳转结果。
    context.header("Cache-Control", "no-store");
    return context.redirect(url, 302);
  });

  app.delete("/api/me/avatar", async (context) => {
    const service = new MediaService(context.var.db, context.var.env);
    return context.json(await service.removeAvatar(context.var.auth));
  });

  app.get("/api/users/:userId/avatar/raw", async (context) => {
    const service = new MediaService(context.var.db, context.var.env);
    const source = await service.getAvatarSource(context.var.auth, context.req.param("userId"));
    if (source.kind === "uploaded") {
      context.header("Cache-Control", "private, max-age=240");
      return context.redirect(source.url, 302);
    }
    const etag = `\"${GENERATED_AVATAR_VERSION}-${source.seed}\"`;
    if (context.req.header("if-none-match") === etag) {
      return context.body(null, 304);
    }
    context.header("Content-Type", "image/svg+xml; charset=utf-8");
    context.header("Cache-Control", "private, max-age=31536000, immutable");
    context.header("ETag", etag);
    return context.body(renderGeneratedAvatar(source.seed));
  });

  app.get("/api/storage/summary", async (context) => {
    const service = new MediaService(context.var.db, context.var.env);
    return context.json(await service.getStorageSummary(context.var.auth));
  });

  app.get("/api/media/limits", (context) => {
    const service = new MediaService(context.var.db, context.var.env);
    return context.json(service.getMediaLimits());
  });

  return app;
}
