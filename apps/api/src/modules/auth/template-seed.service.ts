import { copySystemModuleTemplatesToTenant, seedSystemModuleTemplates } from "@sharebrain/db";

import type { DatabaseClient } from "@sharebrain/db";

export async function seedTenantModuleTemplates(db: DatabaseClient, tenantId: string, actorId: string) {
  await seedSystemModuleTemplates(db);
  await copySystemModuleTemplatesToTenant(db, tenantId, actorId);
}
