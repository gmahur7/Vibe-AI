import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/migrate.js";

const adminUrl = process.env.DATABASE_URL ?? "postgres://postgres:dev@localhost:5433/vibe";
const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));

const testDb = `vibe_test_${Date.now()}`;
const testUrl = new URL(adminUrl);
testUrl.pathname = `/${testDb}`;

async function withClient<T>(url: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function tableExists(table: string): Promise<boolean> {
  return withClient(testUrl.href, async (client) => {
    const { rows } = await client.query("SELECT to_regclass($1) as oid", [table]);
    return rows[0].oid !== null;
  });
}

beforeAll(() => withClient(adminUrl, (client) => client.query(`CREATE DATABASE ${testDb}`)));

afterAll(() =>
  withClient(adminUrl, (client) => client.query(`DROP DATABASE ${testDb} WITH (FORCE)`)),
);

describe("migrate", () => {
  it("applies pending migrations in order", async () => {
    const applied = await migrate(testUrl.href, migrationsDir);
    expect(applied[0]).toBe("001_users.sql");
    expect(await tableExists("users")).toBe(true);
  });

  it("does nothing when run a second time", async () => {
    expect(await migrate(testUrl.href, migrationsDir)).toEqual([]);
  });

  it("rolls back a failing migration and does not record it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "migrations-"));
    await writeFile(join(dir, "999_broken.sql"), "CREATE TABLE half_done (id INT); SELECT nope;");

    await expect(migrate(testUrl.href, dir)).rejects.toThrow("Migration 999_broken.sql failed");

    expect(await tableExists("half_done")).toBe(false);
    await rm(dir, { recursive: true });
  });
});
