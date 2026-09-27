import assert from "node:assert/strict";
import test from "node:test";
import { captureWorkspaceSession } from "./workspaceSession.js";
import { fakeAuth, ids, deferred } from "../sync/testSupport/fixtures.js";

for (const [name, change] of [
  ["account", state => { state.user = { id: ids.other, workspace_id: ids.otherWorkspace }; }],
  ["workspace", state => { state.user.workspace_id = ids.otherWorkspace; }],
  ["same-account new session", state => { state.generation++; state.identity = "session-B"; state.refresh = "refresh-B"; }],
  ["logout", state => { state.current = false; state.user = null; }],
]) {
  test(`workspace response cannot save stale user state after ${name} changes during JSON read`, async () => {
    const auth = fakeAuth(), body = deferred(); let writes = 0;
    auth.saveUser = user => { writes++; auth.state.user = user; };
    const session = captureWorkspaceSession(auth);
    const handler = (async () => {
      const data = await body.promise;
      return session.saveWorkspace(data.workspace.id);
    })();
    change(auth.state);
    const expected = structuredClone(auth.state.user);
    body.resolve({ workspace: { id: ids.workspace } });
    assert.equal(await handler, false); assert.equal(session.isCurrent(), false);
    assert.equal(writes, 0); assert.deepEqual(auth.state.user, expected);
  });
}

test("current workspace response preserves current user fields and permits normal access refresh", () => {
  const auth = fakeAuth(); auth.saveUser = user => { auth.state.user = user; };
  const session = captureWorkspaceSession(auth);
  auth.state.access = "refreshed-access"; auth.state.user.username = "Updated";
  assert.equal(session.saveWorkspace(ids.otherWorkspace), true);
  assert.equal(auth.state.user.username, "Updated"); assert.equal(auth.state.user.workspace_id, ids.otherWorkspace);
  assert.equal(session.saveWorkspace(null), false); // Original request's scope is now obsolete.
});
