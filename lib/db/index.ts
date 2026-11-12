// The one place that knows which Postgres driver is in use.
//
//   DATABASE_URL set    → Neon (serverless driver over WebSockets, supports transactions)
//   DATABASE_URL unset  → PGlite, an in-process Postgres stored in .data/pglite
//
// Everything else imports `getDb()` and the table objects from ./schema.
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export * as tables from "./schema";
export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
/** A transaction handle; accepted anywhere a Db is. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");
export const PGLITE_DIR = path.join(process.cwd(), ".data", "pglite");

interface Handle {
  db: Db;
  kind: "neon" | "pglite";
  ready: Promise<void>;
  close: () => Promise<void>;
}

// Kept on globalThis so Next.js dev (several module graphs, hot reloads) opens
// the PGlite data directory only once per process.
const g = globalThis as unknown as { __ctDb?: Handle };

export function databaseUrl(forMigrations = false) {
  return (forMigrations && process.env.DATABASE_URL_UNPOOLED) || process.env.DATABASE_URL || "";
}

async function openNeon(url: string): Promise<Handle> {
  const [{ Pool, neonConfig }, { drizzle }, ws] = await Promise.all([
    import("@neondatabase/serverless"),
    import("drizzle-orm/neon-serverless"),
    import("ws"),
  ]);
  neonConfig.webSocketConstructor = ws.default;
  const pool = new Pool({ connectionString: url });
  const db = drizzle({ client: pool, schema }) as unknown as Db;
  return { db, kind: "neon", ready: Promise.resolve(), close: () => pool.end() };
}

/** Open a PGlite database. `dataDir` undefined → in-memory (tests). */
export async function openPglite(dataDir?: string, opts: { migrate?: boolean } = {}): Promise<Handle> {
  const [{ PGlite }, { drizzle }] = await Promise.all([import("@electric-sql/pglite"), import("drizzle-orm/pglite")]);
  if (dataDir) (await import("node:fs")).mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle({ client, schema }) as unknown as Db;
  const ready = opts.migrate === false ? client.waitReady : migrateDb(db, "pglite");
  return { db, kind: "pglite", ready, close: () => client.close() };
}

/** Apply drizzle/ migrations. Already-applied ones are skipped, so this is safe to rerun. */
export async function migrateDb(db: Db, kind: Handle["kind"]) {
  if (kind === "neon") {
    const { migrate } = await import("drizzle-orm/neon-serverless/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder: MIGRATIONS_DIR });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder: MIGRATIONS_DIR });
  }
}

let opening: Promise<Handle> | undefined;

async function open(): Promise<Handle> {
  const url = databaseUrl();
  if (url) return openNeon(url);
  if (process.env.VERCEL) {
    throw new Error("DATABASE_URL is not set. Add the Neon integration (or a Postgres URL) in Vercel → Settings → Environment Variables.");
  }
  // Local dev: create/upgrade the schema automatically so `npm run dev` just works.
  return openPglite(PGLITE_DIR);
}

/** The app's database. Opened lazily, once per process. */
export async function getDb(): Promise<Db> {
  if (!g.__ctDb) {
    opening ??= open().then((h) => (g.__ctDb = h));
    try {
      await opening;
    } finally {
      opening = undefined;
    }
  }
  await g.__ctDb!.ready;
  return g.__ctDb!.db;
}

/**
 * For CLI scripts: open the configured database (the unpooled Neon URL when
 * there is one), apply pending migrations, and make it the app's database.
 * Call the returned close() when done so the process can exit.
 */
export async function openForScripts(): Promise<Handle> {
  const url = databaseUrl(true);
  let h: Handle;
  if (url) {
    h = await openNeon(url);
    await migrateDb(h.db, "neon");
  } else {
    if (process.env.VERCEL) {
      throw new Error("DATABASE_URL is not set. Add the Neon integration in Vercel, or set DATABASE_URL, then redeploy.");
    }
    h = await openPglite(PGLITE_DIR);
    await h.ready;
  }
  g.__ctDb = h;
  return {
    ...h,
    close: async () => {
      g.__ctDb = undefined;
      await h.close();
    },
  };
}

export function dbKind(): Handle["kind"] {
  return g.__ctDb?.kind ?? (databaseUrl() ? "neon" : "pglite");
}

/** Use a specific database (tests, scripts). Pass undefined to go back to the default. */
export function setDb(db: Db | undefined, kind: Handle["kind"] = "pglite") {
  g.__ctDb = db ? { db, kind, ready: Promise.resolve(), close: async () => {} } : undefined;
}

export async function closeDb() {
  const h = g.__ctDb;
  g.__ctDb = undefined;
  await h?.close();
}
