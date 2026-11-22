import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { MAX_WORKER_ID } from "./index.js";

const KEY_PREFIX = "snowflake:worker:";

// Both scripts check ownership first, so an instance can never extend or
// delete a lease that has since been taken over by another instance.
const RENEW_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("expire", KEYS[1], ARGV[2])
end
return 0`;

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0`;

export interface WorkerLeaseOptions {
  redis: Redis;
  /** Identifies this process as the owner of the lease. Defaults to a random UUID. */
  instanceId?: string;
  /** How long the lease survives without a renewal. Defaults to 30 s. */
  ttlSeconds?: number;
  /** How often to renew. Defaults to a third of the TTL. */
  renewEveryMs?: number;
  /** Called once if the lease is lost. The process must stop generating IDs. */
  onLost?: () => void;
}

export class WorkerLease {
  private timer: NodeJS.Timeout | undefined;
  private lastRenewedAt = Date.now();

  private constructor(
    readonly workerId: number,
    private readonly redis: Redis,
    private readonly instanceId: string,
    private readonly ttlSeconds: number,
    private readonly onLost: (() => void) | undefined,
  ) {}

  /** Claims the lowest free worker id and keeps renewing it in the background. */
  static async acquire(options: WorkerLeaseOptions): Promise<WorkerLease> {
    const { redis, onLost } = options;
    const instanceId = options.instanceId ?? randomUUID();
    const ttlSeconds = options.ttlSeconds ?? 30;
    const renewEveryMs = options.renewEveryMs ?? (ttlSeconds * 1000) / 3;

    for (let workerId = 0; workerId <= MAX_WORKER_ID; workerId++) {
      // NX = only set if the key does not exist, so exactly one instance wins each id.
      const result = await redis.set(KEY_PREFIX + workerId, instanceId, "EX", ttlSeconds, "NX");
      if (result === "OK") {
        const lease = new WorkerLease(workerId, redis, instanceId, ttlSeconds, onLost);
        lease.timer = setInterval(() => void lease.renew(), renewEveryMs);
        lease.timer.unref(); // do not keep the process alive just for renewals
        return lease;
      }
    }

    throw new Error("No free Snowflake worker id: all 1024 are leased");
  }

  /** Stops renewing and frees the worker id for another instance. */
  async release(): Promise<void> {
    this.stop();
    await this.redis.eval(RELEASE_SCRIPT, 1, this.key, this.instanceId);
  }

  private get key(): string {
    return KEY_PREFIX + this.workerId;
  }

  private async renew(): Promise<void> {
    try {
      const renewed = await this.redis.eval(
        RENEW_SCRIPT,
        1,
        this.key,
        this.instanceId,
        this.ttlSeconds,
      );
      if (renewed === 1) {
        this.lastRenewedAt = Date.now();
        return;
      }
      this.lose(); // key expired or another instance owns it now
    } catch {
      // Redis unreachable: the lease is still ours until the TTL runs out.
      if (Date.now() - this.lastRenewedAt >= this.ttlSeconds * 1000) {
        this.lose();
      }
    }
  }

  private lose(): void {
    if (!this.timer) return;
    this.stop();
    this.onLost?.();
  }

  private stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
