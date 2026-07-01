import { OpenAPIHono } from "@hono/zod-openapi";

import { requireQuery } from "../../app/validation";
import type { AppEnv } from "../../app/types";
import { SearchService } from "./search.service";

export function createSearchRoutes() {
  const app = new OpenAPIHono<AppEnv>();

  app.get("/api/search", async (context) => {
    const query = requireQuery(context.req.query("q"), "q");
    const service = new SearchService(context.var.db);
    return context.json({ items: await service.search(context.var.auth, query) });
  });

  return app;
}
