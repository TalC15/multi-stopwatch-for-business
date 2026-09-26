
import test from "node:test";
import assert from "node:assert/strict";

import {
  canEnqueuePersonalTimer
} from "./personalSyncPolicy.js";

const scope = {
  userId: "user-A",
  workspaceId: "workspace-A"
};

const personal = {
  id: "timer-1",
  dataMode: "workspace-personal",
  isShared: false,
  userId: scope.userId,
  workspaceId: scope.workspaceId
};

// TEST 1: Doğru kullanıcı ve workspace.
test("Kişisel sayaç outbox adayıdır", () => {
  assert.equal(
    canEnqueuePersonalTimer(personal, scope),
    true
  );
});

// TEST 2: Standalone ve shared engellenmeli.
test("Standalone ve shared sayaçlar reddedilir", () => {
  const standalone = {
    ...personal,
    dataMode: "standalone",
    workspaceId: null,
    userId: null
  };

  const shared = {
    ...personal,
    dataMode: "shared",
    isShared: true
  };

  assert.equal(
    canEnqueuePersonalTimer(standalone, scope),
    false
  );

  assert.equal(
    canEnqueuePersonalTimer(shared, scope),
    false
  );
});

// TEST 3: Hesap ve workspace izolasyonu.
test("Yanlış sahiplik ve kimlik reddedilir", () => {
  assert.equal(
    canEnqueuePersonalTimer(
      personal,
      { ...scope, userId: "user-B" }
    ),
    false
  );

  assert.equal(
    canEnqueuePersonalTimer(
      personal,
      { ...scope, workspaceId: "workspace-B" }
    ),
    false
  );

  assert.equal(
    canEnqueuePersonalTimer(
      { ...personal, isShared: true },
      scope
    ),
    false
  );

  assert.equal(
    canEnqueuePersonalTimer(
      { ...personal, id: "" },
      scope
    ),
    false
  );

  assert.equal(
    canEnqueuePersonalTimer(personal, null),
    false
  );
});
