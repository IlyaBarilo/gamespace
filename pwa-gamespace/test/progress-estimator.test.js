import assert from "node:assert/strict";
import test from "node:test";
import { ProgressEstimator } from "../src/progress-estimator.js";

test("estimates transfer speed and remaining time", () => {
  const estimator = new ProgressEstimator();
  estimator.reset(0);
  assert.equal(estimator.update(100, 1000, 250).speedPerSecond, null);

  const middle = estimator.update(500, 1000, 1000);
  assert.equal(Math.round(middle.speedPerSecond), 533);
  assert.ok(Math.abs(middle.remainingMs - 937.5) < 0.001);

  const complete = estimator.update(1000, 1000, 2000);
  assert.equal(complete.remainingMs, 0);
});

test("resets when progress starts again from zero", () => {
  const estimator = new ProgressEstimator();
  estimator.reset(0);
  estimator.update(800, 1000, 1000);
  const restarted = estimator.update(1, 10, 1200);
  assert.equal(restarted.speedPerSecond, null);
  assert.equal(restarted.remainingMs, null);
});
