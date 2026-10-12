import test from "node:test";
import assert from "node:assert/strict";
import { getShellLocalStorage } from "../src/shell-localstorage.js";

function setup(t) {
  const values = new Map([["gamespace:viewer-menu-tab:v1", "1"], ["score", "game"]]);
  const storage = { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  t.after(() => previous ? Object.defineProperty(globalThis, "localStorage", previous) : delete globalThis.localStorage);
  return { storage, values };
}

test("native game clear does not resurrect game saves; shell reads restore only owned settings", t => {
  const { values } = setup(t);
  const shell = getShellLocalStorage();
  shell.setItem("gamespace:viewer-menu-tab:v1", "0");
  values.clear();
  assert.equal(shell.getItem("gamespace:viewer-menu-tab:v1"), "0");
  assert.equal(shell.getItem("score"), null);
  assert.equal(values.size, 1);
});

test("intentional shell removal is honoured after a later native clear", t => {
  const { values } = setup(t);
  const shell = getShellLocalStorage();
  shell.setItem("gamespace:last-installed:v1", "record");
  shell.removeItem("gamespace:last-installed:v1");
  values.clear();
  assert.equal(shell.getItem("gamespace:last-installed:v1"), null);
});


test("per-archive checks are shell-owned and survive native game clearing without entering game profiles", t => {
  const { values } = setup(t);
  const shell = getShellLocalStorage();
  const key = "gamespace:compatibility-check:archive:v1:id:work-a";
  shell.setItem(key, "observed steps");
  values.clear();
  assert.equal(shell.getItem(key), "observed steps");
  shell.removeItem(key);
  values.clear();
  assert.equal(shell.getItem(key), null);
});
