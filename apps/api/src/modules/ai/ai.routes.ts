import { OpenAPIHono } from "@hono/zod-openapi";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import type { AppEnv } from "../../app/types";
import { AiService } from "./ai.service";

const aiCommandBodySchema = z.object({
  prompt: z.string().min(1).max(100_000),
  toolName: z.enum(["generate", "edit", "comment"]).default("generate"),
});

export function createAiRoutes() {
  const app = new OpenAPIHono<AppEnv>();

  app.post("/api/ai/command", zValidator("json", aiCommandBodySchema), async (context) => {
    const body = context.req.valid("json");
    const service = new AiService(context.var.db, context.var.env);

    return service.streamCommand(context.var.auth, body);
  });

  return app;
}
