import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "vite";
import vue from "@vitejs/plugin-vue";
import { createRenderer, h, reactive, nextTick } from "vue";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  browser,
  loggedIn,
  sidB,
  user,
  deferred,
  installPasswordRequests,
} from "../services/testSupport/authHarness.js";
const root = fileURLToPath(new URL("../../", import.meta.url)),
  compiled = new URL("../../.phase7-password-ui.mjs", import.meta.url);
let View;
const walk = (n) => [n, ...(n.children || []).flatMap(walk)],
  text = (n) => (n.text || "") + (n.children || []).map(text).join("");
const renderer = createRenderer({
  createElement: (tag) => ({
    tag,
    props: {},
    children: [],
    parent: null,
    focus() {
      this.focused = true;
      globalThis.document.activeElement = this;
    },
    getRootNode() {
      return globalThis.document;
    },
    getAttribute(k) {
      return this.props[k] ?? null;
    },
    addEventListener() {},
    removeEventListener() {},
  }),
  setScopeId: (n, id) => {
    n.props[id] = "";
  },
  createText: (value) => ({ text: value }),
  createComment: () => ({ text: "" }),
  setText: (n, v) => {
    n.text = v;
  },
  setElementText: (n, v) => {
    n.children = [{ text: v }];
  },
  patchProp: (n, k, _old, v) => {
    n.props[k] = v;
    n[k] = v;
  },
  parentNode: (n) => n.parent,
  nextSibling: (n) =>
    n.parent?.children[n.parent.children.indexOf(n) + 1] || null,
  insert(n, parent, anchor) {
    if (n.parent) {
      const i = n.parent.children.indexOf(n);
      if (i >= 0) n.parent.children.splice(i, 1);
    }
    n.parent = parent;
    const i = parent.children.indexOf(anchor);
    parent.children.splice(i < 0 ? parent.children.length : i, 0, n);
  },
  remove(n) {
    const i = n.parent?.children.indexOf(n);
    if (i >= 0) n.parent.children.splice(i, 1);
  },
});
const tick = async () => {
  await new Promise((r) => setImmediate(r));
  await nextTick();
};
function fixture(kind = "login", initialLink = null, tab = null) {
  globalThis.Document = class {};
  globalThis.ShadowRoot = class {};
  globalThis.document = Object.assign(new Document(), { activeElement: null });
  const f = {
    route: reactive({ meta: { authKind: kind } }),
    tree: { children: [] },
    calls: [],
    navigation: [],
    login: async () => ({ success: false, error: "Bilgiler doğrulanamadı." }),
    verify: async () => ({ success: false, error: "Kod doğrulanamadı." }),
    request: async () => ({ ok: false, error: "İşlem kapalı." }),
    link: initialLink,
    sockets: 0,
    generation: 0,
    marker: "A",
    auth: tab?.auth,
    events: tab?.window || new EventTarget(),
  };
  globalThis.window = f.events;
  f.switchAuth = () => {
    f.generation++;
    f.marker = "B";
    f.events.dispatchEvent(new Event("keeptimer:auth-session-changed"));
  };
  globalThis.__passwordUi = f;
  f.app = renderer.createApp(View);
  f.app.component("RouterLink", {
    props: ["to"],
    render() {
      return h("a", { href: this.to }, this.$slots.default?.());
    },
  });
  // Deterministic component clock; no real sleeps or browser timing claim.
  const schedule = globalThis.setInterval;
  globalThis.setInterval = (fn) => {
    f.clock = fn;
    return 0;
  };
  try {
    f.app.mount(f.tree);
  } finally {
    globalThis.setInterval = schedule;
  }
  f.input = async (id, value) => {
    const n = walk(f.tree).find((n) => n.props?.id === id);
    assert.ok(n, id);
    n.props["onUpdate:modelValue"](value);
    await nextTick();
  };
  f.submit = async () => {
    walk(f.tree)
      .find((n) => n.tag === "form")
      .props.onSubmit({ preventDefault() {} });
    await tick();
  };
  return f;
}
before(async () => {
  const mocks = {
    auth: `const f=()=>globalThis.__passwordUi;export const passwordLogin=async(...args)=>{f().calls.push(args);return f().login(...args)};
    export const completePasswordMfa=async(...args)=>{f().calls.push(args);return f().verify(...args)};
    export const isPendingPasswordMfa=()=>f().pendingValid!==false;
    export const resendPasswordMfa=async(...args)=>{f().calls.push(['mfa/resend',...args]);return f().request('mfa/resend',...args)};
    export const getUser=()=>({role:'worker'});
    export const getAuthGeneration=()=>f().auth?.getAuthGeneration() ?? f().generation;
    export const getSessionMarker=()=>f().auth?.getSessionMarker() ?? f().marker;
    export const AUTH_SESSION_CHANGED_EVENT='keeptimer:auth-session-changed';
    export const AUTH_USER_CHANGED_EVENT='keeptimer:auth-user-changed';`,
    request: `export const passwordAuthRequest=async(...args)=>{globalThis.__passwordUi.calls.push(args);return globalThis.__passwordUi.request(...args)};`,
    link: `export const takeAuthLink=()=>globalThis.__passwordUi.link;`,
    native: `export const isAndroidAuthPlatform=()=>false;`,
    socket: `export const connectSocket=()=>globalThis.__passwordUi.sockets++;`,
    router: `export const useRoute=()=>globalThis.__passwordUi.route;export const useRouter=()=>({replace:p=>globalThis.__passwordUi.navigation.push(p)});`,
  };
  const output = await build({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: [
      {
        name: "password-ui-test-only",
        enforce: "pre",
        resolveId(s) {
          const key = s.includes("backendSync")
            ? "auth"
            : s.includes("services/passwordAuth")
              ? "request"
              : s.includes("authLink")
                ? "link"
                : s.includes("keepTimerAuth")
                  ? "native"
                  : s.includes("socket.js")
                    ? "socket"
                    : s === "vue-router"
                      ? "router"
                      : null;
          if (key) return "\0p7:" + key;
        },
        load(id) {
          if (id.startsWith("\0p7:")) return mocks[id.slice(4)];
        },
      },
      vue({ template: { compilerOptions: { hoistStatic: false } } }),
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry: root + "src/views/PasswordAuthView.vue", formats: ["es"] },
      rollupOptions: { external: ["vue"] },
    },
  });
  await writeFile(
    compiled,
    (Array.isArray(output) ? output[0] : output).output.find(
      (o) => o.type === "chunk",
    ).code,
  );
  View = (await import(compiled.href)).default;
});
after(async () => {
  await unlink(compiled).catch(() => {});
  delete globalThis.__passwordUi;
});
test("real password form labels, autocomplete, keyboard submit, show/hide and error status", async () => {
  const f = fixture();
  try {
    await tick();
    const fields = walk(f.tree).filter((n) => n.tag === "input");
    assert.equal(fields.length, 2);
    for (const input of fields)
      assert.ok(
        walk(f.tree).some(
          (n) => n.tag === "label" && n.props.for === input.props.id,
        ),
      );
    assert.equal(fields[0].props.autocomplete, "username");
    assert.equal(fields[1].props.autocomplete, "current-password");
    await f.input("auth-email", "long-address-with-many-letters@example.test");
    await f.input("auth-password", "test-only-password");
    await f.submit();
    assert.ok(walk(f.tree).some((n) => n.props?.role === "alert"));
    assert.equal(f.navigation.length, 0);
    assert.equal(f.sockets, 0);
    const show = walk(f.tree).find(
      (n) => n.props?.["aria-controls"] === "auth-password",
    );
    assert.ok(show);
    show.props.onClick();
    await tick();
    assert.equal(
      walk(f.tree).find((n) => n.props?.id === "auth-password").props.type,
      "text",
    );
  } finally {
    f.app.unmount();
  }
});
test("real OTP UI never navigates before verification, resend disabled and challenge never displayed", async () => {
  const f = fixture();
  try {
    f.login = async () => ({
      success: false,
      mfaRequired: true,
      challengeId: "private-challenge",
      context: "private-context",
      retryAfter: 60,
    });
    await f.input("auth-email", "admin@example.test");
    await f.input("auth-password", "test-only-password");
    await f.submit();
    assert.equal(f.navigation.length, 0);
    assert.equal(f.sockets, 0);
    assert.ok(!text(f.tree).includes("private-context"));
    const otp = walk(f.tree).find((n) => n.props?.id === "auth-code");
    assert.equal(otp.props.autocomplete, "one-time-code");
    assert.equal(otp.props.inputmode, "numeric");
    assert.ok(otp.focused);
    const resend = walk(f.tree).find(
      (n) => n.tag === "button" && text(n).includes("saniye sonra yeniden"),
    );
    assert.ok(resend.props.disabled);
    await f.input("auth-code", "12345678");
    await f.submit();
    assert.ok(text(f.tree).includes("Kod doğrulanamadı"));
    assert.equal(f.navigation.length, 0);
    f.verify = async () => ({ success: true, user: { role: "agent" } });
    await f.input("auth-code", "87654321");
    await f.submit();
    assert.deepEqual(f.navigation, ["/agent/customers"]);
    assert.equal(f.sockets, 0);
  } finally {
    f.app.unmount();
  }
});
test("request-link UI makes no delivery claim, exposes status, uses only request POST", async () => {
  const f = fixture("reset");
  try {
    await f.input("auth-email", "owner@example.test");
    f.request = async () => ({
      ok: true,
      data: {
        accepted: true,
        message: "İstek alındı. Teslimat garanti edilmez.",
      },
    });
    await f.submit();
    assert.equal(f.calls[0][0], "reset/request");
    assert.equal(
      walk(f.tree).filter(
        (n) => n.tag === "input" && n.props.type === "password",
      ).length,
      0,
    );
    assert.ok(walk(f.tree).some((n) => n.props?.role === "status"));
    assert.ok(text(f.tree).includes("Teslimat garanti edilmez"));
    assert.equal(f.navigation.length, 0);
  } finally {
    f.app.unmount();
  }
});

test("SOL4 UI: account/session change removes A pending form before resend", async () => {
  const f = fixture();
  try {
    f.login = async () => ({
      mfaRequired: true,
      challengeId: "A",
      context: "A-context",
      retryAfter: 0,
    });
    await f.input("auth-email", "a@example.test");
    await f.input("auth-password", "synthetic-password");
    await f.submit();
    f.pendingValid = false;
    f.clock();
    await tick();
    assert.equal(
      walk(f.tree).some((n) => n.props?.id === "auth-code"),
      false,
    );
    assert.ok(
      !walk(f.tree).some(
        (n) => n.tag === "button" && text(n) === "Kodu yeniden iste",
      ),
    );
    assert.equal(f.calls.filter((c) => c[0] === "mfa/resend").length, 0);
  } finally {
    f.app.unmount();
  }
});
test("SOL4 UI: late resend A cannot write notice into a newer reset screen", async () => {
  const f = fixture();
  let finish;
  try {
    f.login = async () => ({
      mfaRequired: true,
      challengeId: "A",
      context: "A-context",
      retryAfter: 0,
    });
    await f.input("auth-email", "a@example.test");
    await f.input("auth-password", "synthetic-password");
    await f.submit();
    f.request = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const button = walk(f.tree).find(
      (n) => n.tag === "button" && text(n) === "Kodu yeniden iste",
    );
    assert.ok(button);
    const sending = button.props.onClick();
    await tick();
    f.route.meta.authKind = "reset";
    await tick();
    finish({ ok: true, data: { accepted: true, retryAfter: 60 } });
    await sending;
    await tick();
    assert.ok(
      !text(f.tree).includes("Yeni kod sağlayıcı tarafından kabul edildi"),
    );
    assert.equal(f.navigation.length, 0);
  } finally {
    f.app.unmount();
  }
});
test("SOL4 UI: late MFA completion cannot navigate a newer screen", async () => {
  const f = fixture();
  let finish;
  try {
    f.login = async () => ({
      mfaRequired: true,
      challengeId: "A",
      context: "A-context",
      retryAfter: 0,
    });
    await f.input("auth-email", "a@example.test");
    await f.input("auth-password", "synthetic-password");
    await f.submit();
    f.verify = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    await f.input("auth-code", "12345678");
    await f.submit();
    f.route.meta.authKind = "reset";
    await tick();
    finish({ success: true, user: { role: "agent" } });
    await tick();
    assert.equal(f.navigation.length, 0);
    assert.equal(f.sockets, 0);
  } finally {
    f.app.unmount();
  }
});

test("activation form focuses new password, rejects mismatch and renders safe review evidence", async () => {
  const link = {
    purpose: "activation",
    challengeId: "synthetic-test-only",
    context: "never-render-context",
  };
  const f = fixture("activation", link);
  try {
    await tick();
    assert.equal(
      walk(f.tree).find((n) => n.props?.id === "auth-email"),
      undefined,
    );
    assert.ok(
      walk(f.tree).find((n) => n.props?.id === "auth-password").focused,
    );
    await f.input("auth-password", "first-test-password-only");
    await f.input("auth-confirm", "different-test-password");
    await f.submit();
    assert.ok(text(f.tree).includes("Parolalar eşleşmiyor"));
    assert.equal(f.calls.length, 0);
    assert.ok(!text(f.tree).includes(link.context));
  } finally {
    f.app.unmount();
  }
  if (process.env.PHASE7_UI_EVIDENCE_DIR) {
    const dir = process.env.PHASE7_UI_EVIDENCE_DIR;
    await mkdir(dir, { recursive: true });
    const escape = (s) =>
      String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    const serialize = (n) =>
      n.tag
        ? `<${n.tag}${Object.entries(n.props)
            .filter(
              ([k, v]) =>
                !/^on/.test(k) &&
                v !== null &&
                v !== undefined &&
                v !== false &&
                k !== "value",
            )
            .map(([k, v]) => ` ${k}="${escape(v)}"`)
            .join(
              "",
            )}>${n.tag === "input" ? "" : n.children.map(serialize).join("") + `</${n.tag}>`}`
        : escape(n.text || "") + (n.children || []).map(serialize).join("");
    for (const mode of ["login", "mfa", "activation", "reset", "change"]) {
      const view = fixture(
        mode === "mfa" ? "login" : mode,
        mode === "activation" ? link : null,
      );
      try {
        await tick();
        if (mode === "mfa") {
          view.login = async () => ({
            success: false,
            mfaRequired: true,
            challengeId: "fixture",
            context: "not-in-html",
            retryAfter: 60,
          });
          await view.input(
            "auth-email",
            "long-address-for-responsive-review@example.test",
          );
          await view.input("auth-password", "never-render-password");
          await view.submit();
        }
        await writeFile(`${dir}/${mode}.html`, serialize(view.tree));
      } finally {
        view.app.unmount();
      }
    }
  }
});

const sessionButton = (f) =>
  walk(f.tree).find(
    (n) => n.tag === "button" && text(n) === "Oturumları görüntüle",
  );
test("P2 JSON: actual service and view reject A session metadata when B arrives during body parsing", async () => {
  const b = browser(),
    tab = b.tab();
  tab.setFetch(() => loggedIn());
  await tab.auth.login("A", "fixture-pin");
  const api = installPasswordRequests(tab),
    gate = deferred(),
    entered = deferred();
  const f = fixture("change", null, tab);
  f.request = api.passwordAuthRequest;
  try {
    await tick();
    tab.setFetch(() => ({
      ok: true,
      status: 200,
      json: () => {
        entered.resolve();
        return gate.promise;
      },
    }));
    sessionButton(f).props.onClick();
    await entered.promise;
    tab.setFetch(() =>
      loggedIn(sidB, { ...user, id: "00000000-0000-4000-8000-000000000002" }),
    );
    await tab.auth.login("B", "fixture-pin");
    gate.resolve({
      sessions: [
        {
          id: "A-private-session",
          createdAt: "A-private-created",
          expiresAt: "A-private-expiry",
        },
      ],
    });
    await tick();
    assert.equal(text(f.tree).includes("A-private"), false);
    assert.equal(
      walk(f.tree).some((n) => n.tag === "li"),
      false,
    );
  } finally {
    f.app.unmount();
  }
});
test("P2 view: same security route clears already displayed sessions and old operation notices on session change", async () => {
  const f = fixture("change");
  try {
    await tick();
    f.request = async () => ({
      ok: true,
      data: {
        sessions: [
          { id: "A-id", createdAt: "A-created", expiresAt: "A-expiry" },
        ],
      },
    });
    sessionButton(f).props.onClick();
    await tick();
    assert.ok(text(f.tree).includes("A-created"));
    f.switchAuth();
    await tick();
    assert.equal(text(f.tree).includes("A-created"), false);
    assert.equal(f.route.meta.authKind, "change");
  } finally {
    f.app.unmount();
  }
});
test("P2 view: account change suppresses an old revoke success on the same screen", async () => {
  const f = fixture("change"),
    gate = deferred();
  try {
    await tick();
    f.request = () => gate.promise;
    walk(f.tree)
      .find(
        (n) => n.tag === "button" && text(n).includes("tüm oturumlardan çık"),
      )
      .props.onClick();
    await tick();
    f.switchAuth();
    gate.resolve({ ok: true, data: { success: true, requiresLogin: true } });
    await tick();
    assert.equal(text(f.tree).includes("Tüm oturumlar iptal edildi"), false);
  } finally {
    f.app.unmount();
  }
});
