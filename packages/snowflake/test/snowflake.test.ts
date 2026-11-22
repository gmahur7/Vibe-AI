import { describe, expect, it } from "vitest";
import { EPOCH_MS, MAX_WORKER_ID, Snowflake, parseSnowflake } from "../src/index.js";

/** A clock that returns the given readings in order, then repeats the last one. */
function clockFrom(readings: number[]): () => number {
  let i = 0;
  return () => {
    const value = readings[Math.min(i, readings.length - 1)] ?? 0;
    i++;
    return value;
  };
}

describe("Snowflake", () => {
  it("packs timestamp, worker id and counter into the id", () => {
    const gen = new Snowflake({ workerId: 5, now: () => EPOCH_MS + 1000 });

    expect(parseSnowflake(gen.next())).toEqual({
      timestamp: EPOCH_MS + 1000,
      workerId: 5,
      seq: 0,
    });
  });

  it("increments the counter for ids made in the same millisecond", () => {
    const gen = new Snowflake({ workerId: 1, now: () => EPOCH_MS + 1 });

    const seqs = [gen.next(), gen.next(), gen.next()].map((id) => parseSnowflake(id).seq);

    expect(seqs).toEqual([0, 1, 2]);
  });

  it("resets the counter when the millisecond changes", () => {
    const now = clockFrom([EPOCH_MS + 1, EPOCH_MS + 1, EPOCH_MS + 2]);
    const gen = new Snowflake({ workerId: 1, now });

    gen.next();
    gen.next();

    expect(parseSnowflake(gen.next())).toMatchObject({ timestamp: EPOCH_MS + 2, seq: 0 });
  });

  it("waits for the next millisecond after 4096 ids in one millisecond", () => {
    let calls = 0;
    const now = () => (++calls > 5000 ? EPOCH_MS + 1 : EPOCH_MS);
    const gen = new Snowflake({ workerId: 1, now });

    for (let i = 0; i < 4096; i++) gen.next();

    expect(parseSnowflake(gen.next())).toMatchObject({ timestamp: EPOCH_MS + 1, seq: 0 });
  });

  it("waits instead of going back in time when the clock moves backwards", () => {
    const gen = new Snowflake({
      workerId: 1,
      now: clockFrom([EPOCH_MS + 100, EPOCH_MS + 99, EPOCH_MS + 99, EPOCH_MS + 101]),
    });

    const first = gen.next();
    const second = gen.next();

    expect(parseSnowflake(second).timestamp).toBe(EPOCH_MS + 101);
    expect(second).toBeGreaterThan(first);
  });

  it("produces unique, strictly increasing ids with the real clock", () => {
    const gen = new Snowflake({ workerId: 7 });
    const ids = Array.from({ length: 10_000 }, () => gen.next());

    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]! > ids[i - 1]!).toBe(true);
    }
  });

  it("gives different ids to different workers at the same instant", () => {
    const now = () => EPOCH_MS + 1;
    const a = new Snowflake({ workerId: 1, now });
    const b = new Snowflake({ workerId: 2, now });

    expect(a.next()).not.toBe(b.next());
  });

  it("rejects worker ids outside 0-1023", () => {
    expect(() => new Snowflake({ workerId: -1 })).toThrow(RangeError);
    expect(() => new Snowflake({ workerId: MAX_WORKER_ID + 1 })).toThrow(RangeError);
    expect(() => new Snowflake({ workerId: 1.5 })).toThrow(RangeError);
  });
});
