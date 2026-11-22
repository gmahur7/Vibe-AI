import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const MIGRATION_LOCK_ID = 7274;

export async function migrate(databaseUrl: string, migrationsDir: string): Promise<string[]> {
  const client = new pg.Client({
    connectionString: databaseUrl,
  });

  await client.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);

    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
                name    TEXT PRIMARY KEY,
                applied_at  TIMESTAMPTZ NOT NULL DEFAULT now() 
            )`,
    );

    const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const alreadyApplied = new Set(rows.map((row) => row.name));

    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
    const applied: string[] = [];

    for (const file of files) {
      if (alreadyApplied.has(file)) continue;
      const sql = await readFile(join(migrationsDir, file), "utf-8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed`, { cause: error });
      }

      applied.push(file);
    }
    return applied;
  } finally {
    await client.end();
  }
}
