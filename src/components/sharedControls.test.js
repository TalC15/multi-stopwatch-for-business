import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "vite";
import vue from "@vitejs/plugin-vue";
import { createRenderer, reactive, nextTick } from "vue";
import { writeFile, unlink } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import {
  TIMER_SORT,
  normalizeTimerSort,
  sortTimers,
} from "../domain/timerSort.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const modules = {};
const files = [];

// Test ortamı
globalThis.Audio = class {
  pause() {}

  play() {
    return Promise.resolve();
  }
};

globalThis.document = {
  body: {
    offsetHeight: 0,
  },

  addEventListener() {},
  removeEventListener() {},
};

globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

globalThis.localStorage = {
  getItem: () => null,
};

// Özel Vue renderer
const renderer = createRenderer({
  createElement: (tag) => ({
    tag,
    props: {},
    children: [],
    parent: null,

    addEventListener(k, v) {
      this.props["on" + k[0].toUpperCase() + k.slice(1)] = v;
    },

    removeEventListener() {},

    setAttribute(k, v) {
      this.props[k] = v;
    },

    removeAttribute(k) {
      delete this.props[k];
    },

    classList: {
      add() {},
      remove() {},
    },

    focus() {},

    contains(node) {
      return walk(this).includes(node);
    },

    querySelector(selector) {
      if (selector === '[aria-pressed="true"]') {
        return (
          walk(this).find(
            (node) =>
              node.tag === "button" && node.props?.["aria-pressed"] === true,
          ) ?? null
        );
      }

      return null;
    },
  }),

  createText: (text) => ({ text }),

  createComment: (text) => ({
    text: "",
  }),

  setText: (node, value) => {
    node.text = value;
  },

  setElementText: (node, value) => {
    node.children = [{ text: value }];
  },

  patchProp: (node, key, _old, value) => {
    node.props[key] = value;
    node[key] = value;
  },

  parentNode: (node) => node.parent,

  nextSibling: (node) =>
    node?.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,

  insert(node, parent, anchor) {
    if (node.parent) {
      const index = node.parent.children.indexOf(node);

      if (index >= 0) {
        node.parent.children.splice(index, 1);
      }
    }

    node.parent = parent;

    const index = parent.children.indexOf(anchor);

    parent.children.splice(index < 0 ? parent.children.length : index, 0, node);
  },

  remove(node) {
    if (node?.parent) {
      const index = node.parent.children.indexOf(node);

      if (index >= 0) {
        node.parent.children.splice(index, 1);
      }
    }
  },
});

// Yardımcı fonksiyonlar
const walk = (node) => [node, ...(node.children ?? []).flatMap(walk)];

const text = (node) =>
  (node.text ?? "") + (node.children ?? []).map(text).join("");

const button = (tree, label) =>
  walk(tree).find(
    (node) => node.tag === "button" && text(node).includes(label),
  );

const cardNames = (tree) =>
  walk(tree)
    .filter((node) => node.props?.["aria-label"]?.startsWith("Sil: "))
    .map((node) => node.props["aria-label"].slice(5));

// Store fixture
function fixture() {
  const calls = [];

  const store = reactive({
    sharedWritable: false,
    sharedState: "offline-readonly",
    sharedPending: false,
    ready: true,

    user: {
      id: "u",
      workspace_id: "w",
    },

    sharedNotice: {
      state: "offline-readonly",
      tone: "warning",
      message:
        "İnternet bağlantısı bekleniyor. Ortak sayaçlar çevrimdışıyken değiştirilemez.",
    },

    stopwatches: [],
    presetTimes: [],
    presetNames: [],
    name: "Work",
    duration: 1,
    roleStyles: {},

    initialize() {},

    requireSharedWrite() {
      calls.push("guard");
      return this.sharedWritable;
    },

    async startTimer() {
      calls.push("start");
      return true;
    },

    async pauseTimer() {
      calls.push("pause");
      return true;
    },

    async updateIsPay() {
      calls.push("pay");
      return true;
    },

    async deleteTimer() {
      calls.push("delete");
      return true;
    },

    async addTimer() {
      calls.push("create");
      return "new";
    },
  });

  globalThis.__sharedUi = {
    store,
    calls,
  };

  return {
    store,
    calls,
  };
}

function mount(name, props) {
  const tree = {
    children: [],
  };

  const app = renderer.createApp(modules[name], props);

  app.mount(tree);

  return {
    tree,
    app,
  };
}

// Vue bileşenlerini test için derle
before(async () => {
  const entries = {
    Card: "src/components/stopwatch/StopwatchCard.vue",
    Add: "src/components/stopwatch/AddModal.vue",
    Home: "src/views/HomeView.vue",
  };

  for (const [name, entry] of Object.entries(entries)) {
    const mocks = {
      store: "export const useStopwatchStore=()=>globalThis.__sharedUi.store;",

      theme: "export const useThemeStore=()=>({applyTheme(){}});",

      message: `
        export const message = {
          warning: t =>
            globalThis.__sharedUi.calls.push("warning"),

          success() {},
          error() {},

          loading() {
            return Symbol("loading");
          },

          dismiss() {},

          withLoading(_text, task) {
            return async function (...args) {
              return await task.apply(this, args);
            };
          },
        };
      `,

      backend:
        'export const getAccessToken=()=>"test";' +
        "export const getUser=()=>globalThis.__sharedUi.store.user;" +
        "export const getAuthGeneration=()=>1;" +
        "export const apiFetch=async()=>({ok:true,json:async()=>({workspace:{shared_mode_enabled:true}})});",

      router:
        'import {h} from "vue";' +
        "export const RouterLink={" +
        'props:["to"],' +
        'render(){return h("a",{href:this.to},this.$slots.default?.());}' +
        "};",

      experience: `export const accountExperience={ state:{status:'verified',data:{account:{kind:'company'}}}, currentData:{value:{account:{kind:'company'}}}, canShared:()=>true, canFeature:()=>true, refresh:async()=>true, requireFeature:async()=>true };`,
      haptics: "export const hapticTap=()=>{};",

      audio: 'export default "";',

      stub: "export default {render(){return null;}};",
    };

    const result = await build({
      configFile: false,
      root,
      logLevel: "silent",

      resolve: {
        alias: {
          "@": path.join(root, "src"),
        },
      },

      plugins: [
        {
          name: "disable-css-transitions-in-tests",
          enforce: "pre",

          transform(source, id) {
            const file = id.split("?")[0].replaceAll("\\", "/");

            if (!file.endsWith("/TimerSortMenu.vue")) {
              return null;
            }

            return source.replace(
              /<Transition(\s|>)/g,
              '<Transition :css="false"$1',
            );
          },
        },
        {
          name: "phase5-ui-fixture",
          enforce: "pre",

          resolveId(source) {
            const key =
              source === "vue-router"
                ? "router"
                : source.includes("stopwatchStore")
                  ? "store"
                  : source.includes("themeStore")
                    ? "theme"
                    : source.includes("composables/message")
                      ? "message"
                      : source.includes("services/accountExperience")
                        ? "experience"
                      : source.includes("backendSync")
                        ? "backend"
                        : source.includes("haptics")
                          ? "haptics"
                          : source.endsWith(".mp3")
                            ? "audio"
                            : /Navbar.vue|SettingsDrawer.vue/.test(source)
                              ? "stub"
                              : null;

            if (key) {
              return "\0fixture:" + key;
            }
          },

          load(id) {
            if (id.startsWith("\0fixture:")) {
              return mocks[id.slice(9)];
            }
          },
        },

        vue({
          template: {
            compilerOptions: {
              hoistStatic: false,
            },
          },
        }),
      ],

      build: {
        write: false,
        minify: false,

        lib: {
          entry: path.join(root, entry),
          formats: ["es"],
        },

        rollupOptions: {
          external: ["vue"],
        },
      },
    });

    const file = path.join(root, `.phase5-ui-${name}.mjs`);

    files.push(file);

    const output = (Array.isArray(result) ? result[0] : result).output.find(
      (item) => item.type === "chunk",
    );

    await writeFile(file, output.code);

    modules[name] = (await import(pathToFileURL(file).href)).default;
  }
});

after(async () => {
  await Promise.all(files.map((file) => unlink(file).catch(() => {})));

  delete globalThis.__sharedUi;
});

// ======================================================
// TEST 1: Kişisel senkronizasyon çakışması
// ======================================================

test("Home identifies personal conflict and requires separate explicit acceptance", async () => {
  const { store, calls } = fixture();

  Object.assign(store, {
    syncStatus: "conflict",
    pendingCount: 1,
    resolvingSync: false,
    syncReview: null,

    syncIssues: [
      {
        seq: 1,
        timerId: "personal",
        name: "Local edit",
        method: "Kaydetme",
        httpStatus: 409,
        reason: "Çakışma",
        canReview: true,
      },
    ],

    reviewSyncIssue() {
      calls.push("review");

      this.syncReview = {
        name: "Local edit",
        serverName: "Other device",
        revision: 9,
        kind: "active",
      };
    },

    acceptSyncServer() {
      calls.push("accept");

      this.syncReview = null;
      this.syncIssues = [];
      this.pendingCount = 0;
      this.syncStatus = "done";
    },

    cancelSyncReview() {
      calls.push("cancel");
      this.syncReview = null;
    },

    retrySync() {
      calls.push("retry");
    },
  });

  const { tree, app } = mount("Home");

  try {
    assert.match(text(tree), /Local edit/);

    assert.match(text(tree), /409/);

    await button(tree, "Sunucu kaydını incele").props.onClick();

    await nextTick();

    assert.match(text(tree), /Other device/);

    assert.match(text(tree), /bekleyen değişikliklerinden vazgeçilir/);

    assert.equal(calls.includes("accept"), false);

    await button(tree, "Koru ve vazgeç").props.onClick();

    await nextTick();

    assert.equal(store.pendingCount, 1);

    await button(tree, "Sunucu kaydını incele").props.onClick();

    await nextTick();

    await button(tree, "Yerel değişikliklerden vazgeç").props.onClick();

    await nextTick();

    assert.deepEqual(calls, ["review", "cancel", "review", "accept"]);

    assert.equal(text(tree).includes("Bazı sayaçlar"), false);
  } finally {
    app.unmount();
  }
});

// ======================================================
// TEST 2: Kişisel kronometre sıralaması
// ======================================================

test("Home sorts only visible personal cards", async () => {
  const { store, calls } = fixture();

  store.stopwatches = [
    {
      id: "far",
      name: "Far",
      type: "up",
      status: "running",
      targetMinutes: 10,
      elapsed: 100000,
      isShared: false,
    },

    {
      id: "finished",
      name: "Finished",
      type: "up",
      status: "running",
      targetMinutes: 10,
      elapsed: 600000,
      reachedTarget: true,
      isShared: false,
    },

    {
      id: "near",
      name: "Near",
      type: "up",
      status: "paused",
      targetMinutes: 10,
      elapsed: 590000,
      isShared: false,
    },

    {
      id: "hidden",
      name: "Hidden",
      type: "down",
      status: "running",
      targetMinutes: 10,
      remaining: 10,
      isShared: false,
    },

    {
      id: "shared",
      name: "Shared",
      type: "up",
      status: "running",
      targetMinutes: 10,
      elapsed: 599999,
      isShared: true,
    },
  ];

  const original = store.stopwatches.map((timer) => timer.id);

  const { tree, app } = mount("Home");

  try {
    assert.deepEqual(cardNames(tree), ["Finished", "Near", "Far"]);

    // Yeni menünün açılması
    const trigger = button(tree, "Sırala");

    assert.ok(trigger);

    await trigger.props.onClick();
    await nextTick();

    // Menünün iki seçeneği bulunmalı
    const options = walk(tree).filter(
      (node) =>
        node.tag === "button" &&
        typeof node.props?.["aria-pressed"] === "boolean",
    );

    assert.equal(options.length, 2);

    assert.ok(options.some((node) => text(node).includes("Önce bitenler")));

    assert.ok(options.some((node) => text(node).includes("Önce uzak olanlar")));

    // Ters sıralama
    const farthest = button(tree, "Önce uzak olanlar");

    assert.ok(farthest);

    await farthest.props.onClick();
    await nextTick();

    assert.deepEqual(cardNames(tree), ["Far", "Near", "Finished"]);

    // Kaynak liste değişmemeli
    assert.deepEqual(
      store.stopwatches.map((timer) => timer.id),
      original,
    );

    // İşlem yapılmamalı
    assert.deepEqual(calls, []);

    // Geçersiz sıralama varsayılana dönmeli
    assert.equal(normalizeTimerSort("__proto__"), TIMER_SORT.NEAREST);

    const personal = store.stopwatches.filter(
      (timer) => timer.type === "up" && !timer.isShared,
    );

    assert.deepEqual(
      sortTimers(personal, "__proto__").map((timer) => timer.name),

      ["Finished", "Near", "Far"],
    );
  } finally {
    app.unmount();
  }
});

// ======================================================
// TEST 3-4: Ortak kartların yazma izni kontrolü
// ======================================================

for (const type of ["up", "down"]) {
  test(`${type} card guards actual Start/Pause, payment, Delete and an already-open confirmation`, async () => {
    const { store, calls } = fixture();

    const timer = reactive({
      id: "t",
      name: "Test",
      isShared: true,
      type,
      status: "running",
      targetMinutes: 1,
      elapsed: 0,
      remaining: 60000,
      isPay: false,
    });

    const { tree, app } = mount("Card", { timer });

    try {
      const pause = button(tree, "Durdur");

      const pay = button(tree, "Ödenmedi");

      const del = walk(tree).find(
        (node) => node.props?.["aria-label"] === "Sil: Test",
      );

      for (const currentButton of [pause, pay, del]) {
        assert.ok(
          currentButton,
          "Buton bulunamadı. Mevcut butonlar: " +
            walk(tree)
              .filter((node) => node.tag === "button")
              .map(
                (node) =>
                  text(node) || node.props?.["aria-label"] || "(etiketsiz)",
              )
              .join(" | "),
        );

        assert.equal(currentButton.props["aria-disabled"], true);

        assert.notEqual(currentButton.props.disabled, true);

        await currentButton.props.onClick();
      }

      assert.deepEqual(calls, ["guard", "guard", "guard"]);

      timer.status = "idle";

      await nextTick();

      const startButton = button(tree, "Başlat") ?? button(tree, "Start");

      assert.ok(startButton, "Başlatma butonu bulunamadı");

      await startButton.props.onClick();

      assert.equal(calls.at(-1), "guard");

      assert.equal(calls.includes("start"), false);

      store.sharedWritable = true;

      await nextTick();

      await del.props.onClick();

      await nextTick();

      store.sharedWritable = false;

      await nextTick();

      const confirm = button(tree, "Sil");

      assert.equal(confirm.props["aria-disabled"], true);

      await confirm.props.onClick();

      assert.equal(calls.includes("delete"), false);

      store.sharedWritable = true;

      await nextTick();

      await confirm.props.onClick();

      await nextTick();

      assert.equal(calls.filter((value) => value === "delete").length, 1);
    } finally {
      app.unmount();
    }
  });
}

// ======================================================
// TEST 5-6: Ortak zamanlayıcı oluşturma izni
// ======================================================

for (const forceShared of [true, false]) {
  test(`AddModal forceShared=${forceShared} blocks shared create and automatic start`, async () => {
    const { calls } = fixture();

    const { tree, app } = mount("Add", {
      isOpen: true,
      defaultType: "up",
      forceShared,
    });

    try {
      await new Promise((resolve) => setImmediate(resolve));

      await nextTick();

      if (!forceShared) {
        const toggle = walk(tree).find((node) => node.props?.role === "switch");

        assert.ok(toggle);

        await toggle.props.onClick();

        await nextTick();
      }

      const save = walk(tree).find(
        (node) => node.tag === "button" && text(node).includes("oluştur"),
      );

      assert.ok(save);

      await save.props.onClick();

      assert.equal(calls.includes("create"), false);

      assert.equal(calls.includes("start"), false);

      assert.ok(calls.includes("guard"));
    } finally {
      app.unmount();
    }
  });
}

// ======================================================
// TEST 7: Ortak sekme ve ekleme izni
// ======================================================

test("Home shared band is announced and shared floating Add is guarded", async () => {
  const { calls } = fixture();

  const { tree, app } = mount("Home");

  try {
    await button(tree, "Ortak").props.onClick();

    await nextTick();

    assert.ok(
      walk(tree).some(
        (node) =>
          node.props?.role === "status" &&
          node.props["aria-live"] === "polite" &&
          text(node).includes("çevrimdışı"),
      ),
    );

    const add = walk(tree).find(
      (node) => node.tag === "button" && node.props["aria-disabled"] === true,
    );

    assert.ok(add);

    await add.props.onClick();

    assert.ok(calls.includes("guard"));

    assert.equal(calls.includes("create"), false);
  } finally {
    app.unmount();
  }
});

// ======================================================
// TEST 8: Sunucu saati kullanımı
// ======================================================

test("shared card renders controller server-time elapsed, not the device wall clock", async () => {
  fixture();

  const { tree, app } = mount("Card", {
    timer: {
      id: "t",
      name: "Clock",
      isShared: true,
      type: "up",
      status: "running",
      targetMinutes: 1,
      elapsed: 2500,
      accumulatedTime: 0,
      startTime: Date.now() - 100000,
      isPay: false,
    },
  });

  try {
    await nextTick();

    assert.match(text(tree), /00:02/);

    assert.doesNotMatch(text(tree), /01:40/);
  } finally {
    app.unmount();
  }
});

// ======================================================
// TEST 9-17: Ortak durum mesajları
// ======================================================

const sharedStates = [
  [
    "signed-out",
    "info",
    "Ortak zamanlayıcıları kullanmak için giriş yapın.",
    "/login",
    "Giriş yap",
  ],

  [
    "workspace-required",
    "info",
    "Ortak sayaçları kullanmak için bir şirkete katılın.",
    "/profile",
    "Şirkete katıl",
  ],

  ["loading", "neutral", "Ortak bölüm hazırlanıyor…"],

  ["reconciling", "neutral", "Ortak zamanlayıcılar güncelleniyor…"],

  [
    "offline-readonly",
    "warning",
    "İnternet bağlantısı bekleniyor. Ortak sayaçlar çevrimdışıyken değiştirilemez.",
  ],

  [
    "unavailable",
    "warning",
    "Ortak sayaçlara şu anda ulaşılamıyor. Değişiklik yapmadan yeniden deneyin.",
  ],

  [
    "auth-required",
    "error",
    "Ortak zamanlayıcılar için oturumunuzu doğrulayın.",
    "/login",
    "Giriş yap",
  ],

  ["pending", "neutral", "Ortak zamanlayıcı işlemi tamamlanıyor…"],

  ["ready", "info", "Ortak zamanlayıcılar ekip üyeleriyle güncel tutulur."],
];

for (const [state, tone, message, to, action] of sharedStates) {
  test(`Home shared ${state} renders one themed message, correct action and no personal warning`, async () => {
    const { store, calls } = fixture();

    Object.assign(store, {
      sharedNotice: {
        state,
        tone,
        message,
        to,
        action,
      },

      syncStatus: "retry",
      pendingCount: 2,

      syncIssues: [
        {
          seq: 1,
          name: "Private conflict",
          reason: "Personal issue",
          method: "Kaydetme",
        },
      ],

      loadSharedTimers() {
        calls.push("reload-shared");
      },
    });

    const { tree, app } = mount("Home");

    try {
      await button(tree, "Ortak").props.onClick();

      await nextTick();

      const panels = walk(tree).filter((node) => node.props?.role === "status");

      assert.equal(panels.length, 1);

      assert.match(
        text(panels[0]),
        new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );

      assert.equal(panels[0].props["data-state"], state);

      assert.equal(panels[0].props["aria-live"], "polite");

      assert.match(panels[0].props.class, /dark:/);

      assert.equal(/animate-/.test(panels[0].props.class), false);

      assert.ok(
        walk(panels[0]).some(
          (node) => node.tag === "svg" && node.props["aria-hidden"] === "true",
        ),
      );

      assert.equal(text(tree).includes("Private conflict"), false);

      assert.equal(text(tree).includes("kişisel"), false);

      assert.equal(
        Boolean(button(tree, "Senkronizasyonu yeniden dene")),
        false,
      );

      const links = walk(panels[0]).filter((node) => node.tag === "a");

      assert.equal(links.length, to ? 1 : 0);

      if (to) {
        assert.equal(links[0].props.href, to);

        assert.equal(text(links[0]), action);
      }

      if (state === "unavailable") {
        await button(tree, "Yeniden dene").props.onClick();

        assert.deepEqual(calls, ["reload-shared"]);
      }

      assert.equal(
        text(tree).includes("Henüz ortak kronometre veya sayaç yok"),
        state === "ready",
      );
    } finally {
      app.unmount();
    }
  });
}

// ======================================================
// TEST 18: Kişisel ve ortak bildirim ayrımı
// ======================================================

test("Home hides personal notice and shows shared notice only in its own tab", async () => {
  const { store } = fixture();

  Object.assign(store, {
    syncStatus: "retry",
    pendingCount: 2,
    retrySync() {},
  });

  const { tree, app } = mount("Home");

  try {
    const statusPanels = () =>
      walk(tree).filter((node) => node.props?.role === "status");

    // Kişisel bildirim yorumda
    assert.equal(statusPanels().length, 0);

    assert.equal(text(tree).includes("Kişisel sayaçlar"), false);

    assert.equal(text(tree).includes(store.sharedNotice.message), false);

    // Ortak sekmesi
    await button(tree, "Ortak").props.onClick();

    await nextTick();

    const panels = statusPanels();

    assert.equal(panels.length, 1);

    assert.equal(panels[0].props["data-state"], store.sharedNotice.state);

    assert.ok(text(panels[0]).includes(store.sharedNotice.message));

    // Kişisel sekmeye dönüş
    await button(tree, "Kronometre").props.onClick();

    await nextTick();

    assert.equal(statusPanels().length, 0);

    assert.equal(text(tree).includes(store.sharedNotice.message), false);
  } finally {
    app.unmount();
  }
});

// ======================================================
// TEST 19-20: Geri sayım bitiş sınırı
// ======================================================

for (const isShared of [true, false]) {
  test(`countdown isShared=${isShared} preserves server completion boundary with a simple label`, async () => {
    fixture();

    const timer = reactive({
      id: "t",
      name: "Deadline",
      isShared,
      type: "down",
      status: "running",
      targetMinutes: 1,
      elapsed: 60000,
      remaining: 0,
      accumulatedTime: 60000,
      startTime: null,
      isPay: false,
    });

    const { tree, app } = mount("Card", { timer });

    try {
      assert.equal(text(tree).includes("Bitiş onayı bekleniyor"), isShared);

      assert.equal(text(tree).includes("Sunucu doğrulaması"), false);

      assert.equal(timer.status, "running");
    } finally {
      app.unmount();
    }
  });
}

// ======================================================
// TEST 21: Ortak zamanlayıcı sıralaması
// ======================================================

test("Home sorts shared timers in read-only mode", async () => {
  const { store, calls } = fixture();

  store.stopwatches = [
    {
      id: "shared-down",
      name: "Shared down",
      type: "down",
      status: "running",
      targetMinutes: 10,
      remaining: 3000,
      elapsed: 597000,
      isShared: true,
      dataMode: "shared",
    },

    {
      id: "personal",
      name: "Personal",
      type: "down",
      status: "running",
      targetMinutes: 10,
      remaining: 1,
      isShared: false,
    },

    {
      id: "shared-up",
      name: "Shared up",
      type: "up",
      status: "running",
      targetMinutes: 10,
      elapsed: 599000,
      isShared: true,
      dataMode: "shared",
    },
  ];

  const original = store.stopwatches.map((timer) => timer.id);

  const { tree, app } = mount("Home");

  try {
    // Ortak sekmesini aç
    await button(tree, "Ortak").props.onClick();

    await nextTick();

    assert.deepEqual(cardNames(tree), ["Shared up", "Shared down"]);

    // Sıralama menüsünü aç
    const trigger = button(tree, "Sırala");

    assert.ok(trigger);

    await trigger.props.onClick();

    await nextTick();

    // En uzak seçeneği
    const farthest = button(tree, "Önce uzak olanlar");

    assert.ok(farthest);

    await farthest.props.onClick();

    await nextTick();

    assert.deepEqual(cardNames(tree), ["Shared down", "Shared up"]);

    // Süre değişince yeniden sıralanmalı
    store.stopwatches[0].remaining = 500;

    await nextTick();

    assert.deepEqual(cardNames(tree), ["Shared up", "Shared down"]);

    // Sıfıra ulaşınca tamamlanan sona geçmeli
    store.stopwatches[0].remaining = 0;

    await nextTick();

    assert.deepEqual(cardNames(tree), ["Shared up", "Shared down"]);

    // Durum değişmemeli
    assert.equal(store.stopwatches[0].status, "running");

    // Kaynak sıra değişmemeli
    assert.deepEqual(
      store.stopwatches.map((timer) => timer.id),
      original,
    );

    // Salt okunur modda işlem yapılmamalı
    assert.deepEqual(calls, []);
  } finally {
    app.unmount();
  }
});
