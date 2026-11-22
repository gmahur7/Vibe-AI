// 2026-01-01T00:00:00Z. Never change this once IDs exist in a database.
export const EPOCH_MS = 1767225600000;

const WORKER_BITS = 10n;
const SEQ_BITS = 12n;
const TIMESTAMP_SHIFT = WORKER_BITS + SEQ_BITS; // 22
const MAX_SEQ = (1 << 12) - 1; // 4095

export const MAX_WORKER_ID = (1 << 10) - 1; // 1023

export interface SnowflakeOptions {
  workerId: number;
  /** Clock in milliseconds. Injectable so tests can control time. */
  now?: () => number;
}

export interface SnowflakeParts {
  timestamp: number;
  workerId: number;
  seq: number;
}

export class Snowflake {
  private readonly workerId: bigint;
  private readonly now: () => number;
  private lastMs = -1;
  private seq = 0;

  constructor(options: SnowflakeOptions) {
    const { workerId } = options;
    if (!Number.isInteger(workerId) || workerId < 0 || workerId > MAX_WORKER_ID) {
      throw new RangeError(`workerId must be an integer between 0 and ${MAX_WORKER_ID}`);
    }
    this.workerId = BigInt(workerId);
    this.now = options.now ?? Date.now;
  }

  next(): bigint {
    let now = this.now();

    // Clock moved backwards: wait for it to catch up instead of reissuing old IDs.
    if (now < this.lastMs) {
      now = this.waitUntil(this.lastMs);
    }

    if (now === this.lastMs) {
      this.seq = (this.seq + 1) & MAX_SEQ;
      // 4096 IDs already issued this millisecond: wait for the next one.
      if (this.seq === 0) {
        now = this.waitUntil(this.lastMs + 1);
      }
    } else {
      this.seq = 0;
    }

    this.lastMs = now;

    return (
      (BigInt(now - EPOCH_MS) << TIMESTAMP_SHIFT) | (this.workerId << SEQ_BITS) | BigInt(this.seq)
    );
  }

  private waitUntil(targetMs: number): number {
    let now = this.now();
    while (now < targetMs) {
      now = this.now();
    }
    return now;
  }
}

export function parseSnowflake(id: bigint): SnowflakeParts {
  return {
    timestamp: Number(id >> TIMESTAMP_SHIFT) + EPOCH_MS,
    workerId: Number((id >> SEQ_BITS) & BigInt(MAX_WORKER_ID)),
    seq: Number(id & BigInt(MAX_SEQ)),
  };
}

export { WorkerLease, type WorkerLeaseOptions } from "./worker-lease.js";
