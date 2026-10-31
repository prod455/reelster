import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePeriod, inPeriod, isBeforePeriod } from "../src/lib/period.js";

const local = (y, m, d, h = 0, min = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, min, s, ms).getTime();

test("parsePeriod treats empty inputs as an open period", () => {
  assert.deepEqual(parsePeriod("", ""), { from: null, to: null });
});

test("parsePeriod covers whole local days, inclusive", () => {
  assert.deepEqual(parsePeriod("2026-01-05", "2026-01-10"), {
    from: local(2026, 1, 5),
    to: local(2026, 1, 10, 23, 59, 59, 999),
  });
});

test("parsePeriod accepts a single bound", () => {
  assert.deepEqual(parsePeriod("2026-01-05", ""), { from: local(2026, 1, 5), to: null });
  assert.deepEqual(parsePeriod("", "2026-01-10"), { from: null, to: local(2026, 1, 10, 23, 59, 59, 999) });
});

test("parsePeriod rejects a start after the end", () => {
  assert.throws(() => parsePeriod("2026-02-01", "2026-01-01"), /start date is after the end date/);
});

test("parsePeriod rejects malformed dates", () => {
  assert.throws(() => parsePeriod("05/01/2026", ""), /invalid date/);
});

test("inPeriod includes both boundaries", () => {
  const period = parsePeriod("2026-01-05", "2026-01-05");
  assert.equal(inPeriod(local(2026, 1, 5), period), true);
  assert.equal(inPeriod(local(2026, 1, 5, 23, 59, 59, 999), period), true);
  assert.equal(inPeriod(local(2026, 1, 4, 23, 59, 59, 999), period), false);
  assert.equal(inPeriod(local(2026, 1, 6), period), false);
});

test("inPeriod accepts everything for an open period", () => {
  assert.equal(inPeriod(0, { from: null, to: null }), true);
});

test("isBeforePeriod tells when the scan has gone past the start", () => {
  const period = parsePeriod("2026-01-05", "");
  assert.equal(isBeforePeriod(local(2026, 1, 4), period), true);
  assert.equal(isBeforePeriod(local(2026, 1, 5), period), false);
  assert.equal(isBeforePeriod(0, { from: null, to: null }), false);
});
