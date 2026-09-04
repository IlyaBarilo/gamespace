import assert from "node:assert/strict";
import test from "node:test";
import { ProgressEstimator } from "../src/progress-estimator.js";

function createEstimator() {
  const estimator = new ProgressEstimator();
  estimator.reset(0);
  return estimator;
}

test("refreshes speed and ETA once per second, completing immediately", () => {
  const estimator = createEstimator();
  const early = estimator.update(100, 1000, 250);
  assert.equal(early.speedPerSecond, null);
  assert.equal(early.updated, false);

  const middle = estimator.update(500, 1000, 1000);
  assert.equal(middle.speedPerSecond, 500);
  assert.equal(middle.remainingMs, 1000);
  assert.equal(middle.updated, true);

  const burst = estimator.update(900, 1000, 1250);
  assert.equal(burst.speedPerSecond, 500);
  assert.equal(burst.remainingMs, 1000);
  assert.equal(burst.updated, false);
  assert.equal(burst.processed, 900);
  const complete = estimator.update(1000, 1000, 1300);
  assert.equal(complete.remainingMs, 0);
  assert.equal(complete.updated, true);
});

test("duplicate events do not inflate the next rate", () => {
  const estimator = createEstimator();
  estimator.update(1000, 10000, 1000);
  for (let at = 1001; at < 2000; at++) estimator.update(1000, 10000, at);
  const next = estimator.update(2000, 10000, 2000);
  assert.equal(next.speedPerSecond, 1000);
  assert.equal(next.remainingMs, 8000);
});

test("the window forgets old rates after fifteen seconds", () => {
  const estimator = createEstimator();
  for (let second = 1; second <= 20; second++) estimator.update(second * 1000, 100000, second * 1000);
  const changed = estimator.update(22000, 100000, 21000);
  assert.ok(Math.abs(changed.speedPerSecond - 16000 / 15) < 0.001);
  for (let second = 22; second < 35; second++) estimator.update(20000 + (second - 20) * 2000, 100000, second * 1000);
  const settled = estimator.update(50000, 100000, 35000);
  assert.equal(settled.speedPerSecond, 2000);
  assert.equal(settled.remainingMs, 25000);
});

test("irregular events interpolate the window boundary by elapsed time", () => {
  const estimator = createEstimator();
  estimator.update(2000, 100000, 2000);
  estimator.update(6000, 100000, 4000);
  const estimate = estimator.update(36000, 100000, 19000);
  assert.equal(estimate.speedPerSecond, 2000);
  const shifted = estimator.update(46000, 100000, 21000);
  // At 6 s the interpolated count is 10000, giving 36000 bytes in 15 s.
  assert.equal(shifted.speedPerSecond, 2400);
});

test("a pause decays to zero with unknown ETA and can resume", () => {
  const estimator = createEstimator();
  estimator.update(1000, 10000, 1000);
  for (let second = 2; second < 16; second++) estimator.update(1000, 10000, second * 1000);
  const paused = estimator.update(1000, 10000, 16000);
  assert.equal(paused.speedPerSecond, 0);
  assert.equal(paused.remainingMs, null);
  const resumed = estimator.update(2500, 10000, 17000);
  assert.equal(resumed.speedPerSecond, 100);
  assert.equal(resumed.remainingMs, 75000);
});

test("restarts the baseline when counters or time go backwards", () => {
  const estimator = createEstimator();
  estimator.update(800, 1000, 1000);
  const restarted = estimator.update(1, 10, 1200);
  assert.equal(restarted.speedPerSecond, null);
  assert.equal(restarted.remainingMs, null);
  assert.equal(restarted.updated, true);
  assert.equal(estimator.update(6, 10, 2200).speedPerSecond, 5);
  assert.equal(estimator.update(7, 10, 2100).speedPerSecond, null);
  assert.equal(estimator.update(9, 10, 3100).speedPerSecond, 2);
});

test("handles unknown totals and completion before the first estimate", () => {
  const estimator = createEstimator();
  assert.equal(estimator.update(100, 0, 1000).remainingMs, null);
  estimator.reset(0);
  const complete = estimator.update(10, 10, 100);
  assert.equal(complete.speedPerSecond, null);
  assert.equal(complete.remainingMs, 0);
  assert.equal(complete.updated, true);
});

test("large archives retain bounded samples during frequent progress events", () => {
  const estimator = createEstimator();
  const total = 40 * 1024 ** 3;
  let estimate;
  for (let at = 1; at <= 60000; at++) estimate = estimator.update(at * 1024 ** 2 / 10, total, at);
  assert.equal(estimate.speedPerSecond, 100 * 1024 ** 2);
  assert.equal(estimate.remainingMs, 349600);
  assert.ok(estimator.samples.length <= 17);
});
