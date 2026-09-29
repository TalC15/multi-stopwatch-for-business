import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { timerDb } from "./timerDb.js";
import {
  getStandaloneTimer,
  getWorkspacePersonalTimer,
  listSharedTimerCache,
  listStandaloneTimers,
  listWorkspacePersonalTimers,
  removeStandaloneTimer,
  replaceSharedCacheFromServerSnapshot,
  saveTimer,
} from "./timerRepository.js";
import {
  deriveTimerDataMode,
  getNewTimerContext,
  getTimerDataMode,
  TIMER_DATA_MODE,
} from "../domain/timerDataMode.js";

const context = (userId, workspaceId) => ({ userId, workspaceId });
const timer = (id, owner, isShared = false) => ({
  id,
  ...owner,
  name: id,
  type: "down",
  targetMinutes: 5,
  isPay: false,
  isShared,
  status: "idle",
  accumulatedTime: 0,
});
const snapshot = (timers) => ({ success: true, timers });

beforeEach(async () => {
  await timerDb.delete();
  await timerDb.open();
});
after(async () => timerDb.close());

test("explicit modes follow workspace and creator context", () => {
  const standalone = getNewTimerContext(null);
  const personal = getNewTimerContext({ id: "A", workspace_id: "X" });
  const shared = getNewTimerContext({ id: "A", workspace_id: "X" }, true);

  assert.equal(getTimerDataMode(timer("one", standalone)), TIMER_DATA_MODE.STANDALONE);
  assert.equal(getTimerDataMode(timer("two", personal)), TIMER_DATA_MODE.WORKSPACE_PERSONAL);
  assert.equal(getTimerDataMode(timer("three", shared, true)), TIMER_DATA_MODE.SHARED);
  assert.equal(deriveTimerDataMode({ workspaceId: null }), TIMER_DATA_MODE.STANDALONE);
  assert.throws(() => getNewTimerContext(null, true));
  assert.throws(() => getTimerDataMode({ ...timer("one", standalone), dataMode: "shared" }));
  assert.throws(() => getTimerDataMode({ ...timer("two", personal), userId: "" }));
  assert.throws(() => getTimerDataMode({ id: "unknown", isShared: false }));
});

test("standalone survives database reopen and cannot affect company records", async () => {
  const local = timer("local", getNewTimerContext(null));
  await saveTimer({ ...local, status: "running", temporaryUiField: "not persisted" });
  await timerDb.close();
  await timerDb.open();

  assert.equal((await getStandaloneTimer("local")).status, "running");
  assert.equal((await getStandaloneTimer("local")).temporaryUiField, undefined);
  assert.equal((await listStandaloneTimers()).length, 1);
  assert.equal(await removeStandaloneTimer("local"), true);
  assert.equal(await getStandaloneTimer("local"), undefined);
});

test("workspace-personal reads and writes require the exact account and workspace", async () => {
  const aX = timer("a-x", getNewTimerContext({ id: "A", workspace_id: "X" }));
  const bX = timer("b-x", getNewTimerContext({ id: "B", workspace_id: "X" }));
  const aY = timer("a-y", getNewTimerContext({ id: "A", workspace_id: "Y" }));
  await saveTimer(aX, context("A", "X"));
  await saveTimer(bX, context("B", "X"));
  await saveTimer(aY, context("A", "Y"));
  await saveTimer({ ...aX, status: "paused", accumulatedTime: 4200 }, context("A", "X"));
  await timerDb.close();
  await timerDb.open();

  assert.deepEqual((await listWorkspacePersonalTimers(context("A", "X"))).map((t) => t.id), ["a-x"]);
  assert.equal(await getWorkspacePersonalTimer("a-x", context("B", "X")), undefined);
  assert.equal(await getWorkspacePersonalTimer("a-x", context("A", "Y")), undefined);
  await assert.rejects(saveTimer({ ...aX, status: "running" }, context("B", "X")));
  await assert.rejects(saveTimer({ ...aX, userId: "B" }, context("B", "X")), /ownership/);
  await assert.rejects(saveTimer({ ...aX, workspaceId: "Y" }, context("A", "Y")), /ownership/);
  assert.equal((await getWorkspacePersonalTimer("a-x", context("A", "X"))).status, "paused");
  assert.equal((await getWorkspacePersonalTimer("a-x", context("A", "X"))).accumulatedTime, 4200);
  assert.equal(await removeStandaloneTimer("a-x"), false);
});

test("local creates require a target and shared cache accepts snapshots only", async () => {
  const local = timer("local", getNewTimerContext(null));
  await assert.rejects(saveTimer({ ...local, targetMinutes: null }), /positive target/);
  const shared = timer("shared", getNewTimerContext({ id: "creator", workspace_id: "X" }, true), true);
  await assert.rejects(saveTimer(shared, context("creator", "X")), /server snapshot/);
  await assert.rejects(replaceSharedCacheFromServerSnapshot({ workspaceId: "X", snapshot: null }));
  assert.deepEqual(await listSharedTimerCache({ workspaceId: "X" }), []);
});

test("shared snapshot is workspace-scoped, preserves creator and rejects failed snapshots", async () => {
  const sharedX = timer("shared-x", getNewTimerContext({ id: "creator-A", workspace_id: "X" }, true), true);
  const sharedY = timer("shared-y", getNewTimerContext({ id: "creator-B", workspace_id: "Y" }, true), true);
  const personalX = timer("personal-x", getNewTimerContext({ id: "creator-A", workspace_id: "X" }));
  await saveTimer(personalX, context("creator-A", "X"));
  await replaceSharedCacheFromServerSnapshot({ workspaceId: "X", snapshot: snapshot([sharedX]) });
  await replaceSharedCacheFromServerSnapshot({ workspaceId: "Y", snapshot: snapshot([sharedY]) });

  await assert.rejects(replaceSharedCacheFromServerSnapshot({
    workspaceId: "X", snapshot: { success: false, timers: [] },
  }));
  await assert.rejects(replaceSharedCacheFromServerSnapshot({
    workspaceId: "X", snapshot: snapshot([{ ...sharedX, userId: "viewer-B" }]),
  }), /creator/);
  await assert.rejects(replaceSharedCacheFromServerSnapshot({
    workspaceId: "X", snapshot: snapshot([sharedY]),
  }), /out-of-scope/);
  assert.equal((await listSharedTimerCache({ workspaceId: "X" }))[0].userId, "creator-A");

  await replaceSharedCacheFromServerSnapshot({ workspaceId: "X", snapshot: snapshot([]) });
  assert.deepEqual(await listSharedTimerCache({ workspaceId: "X" }), []);
  assert.equal((await listSharedTimerCache({ workspaceId: "Y" })).length, 1);
  assert.equal((await listWorkspacePersonalTimers(context("creator-A", "X"))).length, 1);
});
