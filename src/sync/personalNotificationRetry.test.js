import test from "node:test";
import assert from "node:assert/strict";
import { createPersonalSyncApi } from "./personalSyncApi.js";
import {
  fakeAuth,
  response,
  timer,
} from "./testSupport/fixtures.js";

const syncedTimer = (changes = {}) =>
  timer({
    syncState: "synced",
    syncDeleted: false,
    syncRevision: 1,
    ...changes,
  });

function setup(request) {
  const api = createPersonalSyncApi({
    auth: fakeAuth(),
    request,
    baseUrl: "https://mock.invalid",
  });

  return { api, session: api.captureSession() };
}

test("404 blocks repeated notifications until timer state changes", async () => {
  let calls = 0;

  const { api, session } = setup(async () => {
    calls++;
    return response(calls === 1 ? 404 : 200, {
      success: true,
    });
  });

  const current = syncedTimer();

  await assert.rejects(
    api.syncNotification(session, current),
    (err) => err.code === "http-error" && err.status === 404
  );

  await assert.rejects(
    api.syncNotification(session, current),
    (err) =>
      err.code === "notification-blocked" &&
      err.status === 404
  );

  assert.equal(calls, 1);

  await api.syncNotification(session, {
    ...current,
    syncRevision: 2,
  });

  assert.equal(calls, 2);
});

test("401 is transient, with ten-second retry cooldown", async () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  let calls = 0;

  Date.now = () => now;

  try {
    const { api, session } = setup(async () => {
      calls++;
      return response(calls === 1 ? 401 : 200, {
        success: true,
      });
    });

    const current = syncedTimer();

    await assert.rejects(
      api.syncNotification(session, current),
      (err) =>
        err.code === "http-error" && err.status === 401
    );

    await assert.rejects(
      api.syncNotification(session, current),
      (err) => err.code === "notification-cooldown"
    );

    assert.equal(calls, 1);

    now += 10_000;

    await api.syncNotification(session, current);

    assert.equal(calls, 2);
  } finally {
    Date.now = originalNow;
  }
});

test("three temporary failures wait 10s, 30s, then one hour", async () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  let calls = 0;

  Date.now = () => now;

  try {
    const { api, session } = setup(async () => {
      calls++;

      return response(calls <= 3 ? 503 : 200, {
        success: true,
      });
    });

    const current = syncedTimer();

    for (const pause of [10_000, 30_000, 3_600_000]) {
      await assert.rejects(
        api.syncNotification(session, current),
        (err) =>
          err.code === "http-error" && err.status === 503
      );

      await assert.rejects(
        api.syncNotification(session, current),
        (err) => err.code === "notification-cooldown"
      );

      now += pause - 1;

      await assert.rejects(
        api.syncNotification(session, current),
        (err) => err.code === "notification-cooldown"
      );

      now += 1;
    }

    assert.equal(calls, 3);

    await api.syncNotification(session, current);

    assert.equal(calls, 4);
  } finally {
    Date.now = originalNow;
  }
});

test("acknowledged deleted timers skip notification HTTP request", async () => {
  let calls = 0;

  const { api, session } = setup(async () => {
    calls++;

    return response(200, {
      success: true,
    });
  });

  const result = await api.syncNotification(
    session,
    syncedTimer({
      syncState: "deleted",
      syncDeleted: true,
    })
  );

  assert.deepEqual(result, {
    success: true,
    skipped: "already-deleted",
  });

  assert.equal(calls, 0);
});

test("simultaneous requests for the same timer make one HTTP call", async () => {
  let calls = 0;
  let release;

  const pending = new Promise((resolve) => {
    release = resolve;
  });

  const { api, session } = setup(async () => {
    calls++;
    return pending;
  });

  const current = syncedTimer();

  const first = api.syncNotification(session, current);
  const second = api.syncNotification(session, current);

  release(
    response(200, {
      success: true,
    })
  );

  await Promise.all([first, second]);

  assert.equal(calls, 1);
});

test("a new API instance resets in-memory notification retry limits", async () => {
  let calls = 0;

  const request = async () => {
    calls++;

    return response(calls === 1 ? 404 : 200, {
      success: true,
    });
  };

  const current = syncedTimer();
  const first = setup(request);

  await assert.rejects(
    first.api.syncNotification(first.session, current),
    /http-error/
  );

  await assert.rejects(
    first.api.syncNotification(first.session, current),
    /notification-blocked/
  );

  const reloaded = setup(request);

  await reloaded.api.syncNotification(
    reloaded.session,
    current
  );

  assert.equal(calls, 2);
});