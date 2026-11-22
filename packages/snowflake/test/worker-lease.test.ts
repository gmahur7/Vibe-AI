import { Redis } from "ioredis";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkerLease } from "../src/worker-lease.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const leases: WorkerLease[] = [];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function acquire(options: Partial<Parameters<typeof WorkerLease.acquire>[0]> = {}) {
  const lease = await WorkerLease.acquire({ redis, ...options });
  leases.push(lease);
  return lease;
}

async function clearLeases() {
  const keys = await redis.keys("snowflake:worker:*");
  if (keys.length > 0) await redis.del(...keys);
}

beforeEach(clearLeases);

afterEach(async () => {
  await Promise.all(leases.splice(0).map((lease) => lease.release()));
});

afterAll(async () => {
  await clearLeases();
  await redis.quit();
});

describe("WorkerLease", () => {
  it("gives each instance a different worker id", async () => {
    const a = await acquire();
    const b = await acquire();
    const c = await acquire();

    expect([a.workerId, b.workerId, c.workerId]).toEqual([0, 1, 2]);
  });

  it("stores the lease in Redis with a TTL", async () => {
    const lease = await acquire({ instanceId: "ws-1", ttlSeconds: 30 });

    expect(await redis.get(`snowflake:worker:${lease.workerId}`)).toBe("ws-1");
    expect(await redis.ttl(`snowflake:worker:${lease.workerId}`)).toBeGreaterThan(0);
  });

  it("frees the worker id on release so it can be reused", async () => {
    const first = await acquire();
    await first.release();

    const second = await acquire();

    expect(second.workerId).toBe(first.workerId);
  });

  it("keeps the lease alive past its TTL by renewing it", async () => {
    const lease = await acquire({ instanceId: "ws-1", ttlSeconds: 1, renewEveryMs: 200 });

    await sleep(1500);

    expect(await redis.get(`snowflake:worker:${lease.workerId}`)).toBe("ws-1");
  });

  it("reports a lost lease and leaves the new owner's key alone", async () => {
    let lost = false;
    const lease = await acquire({
      instanceId: "ws-1",
      renewEveryMs: 100,
      onLost: () => (lost = true),
    });
    const key = `snowflake:worker:${lease.workerId}`;

    await redis.set(key, "ws-2", "EX", 30); // another instance took the id over
    await sleep(300);
    await lease.release();

    expect(lost).toBe(true);
    expect(await redis.get(key)).toBe("ws-2");
  });
});
