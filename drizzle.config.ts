import { defineConfig } from "drizzle-kit";

// Only used to generate SQL from lib/db/schema.ts (`npm run db:generate`).
// Migrations are applied by `npm run db:migrate` (scripts/db-migrate.ts).
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
});
