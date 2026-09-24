import { io } from "socket.io-client";
import {
  AUTH_SESSION_CHANGED_EVENT,
  AUTH_LOCAL_LOGOUT_EVENT,
  AUTH_ACCESS_TOKEN_REFRESHED_EVENT,
  AUTH_LOGIN_REQUIRED_EVENT,
  getAuthGeneration,
  getRefreshToken,
  refreshAccessToken,
  clearAuthSessionIfCurrent,
  getAccessToken,
  getTabSessionIdentity,
  getTokenSessionIdentity,
  isTabSessionCurrent,
} from "./backendSync";

const SOCKET_URL = "https://multi-stopwatch-backend.onrender.com";
const TRANSIENT_SOCKET_RETRY_DELAYS_MS = [1000, 3000, 7000];
const SOCKET_RECOVERY_PROBE_DELAY_MS = 30_000;

let socket = null;
let socketSessionIdentity = null;

// hasConnectedBefore bilgisinin hangi auth session'a
// ait olduğunu takip eder.
// Aynı session içindeki reconnect'te korunur,
// başka kullanıcı/session login olduğunda sıfırlanır.
let connectionHistorySessionIdentity = null;

// Listener'ları socket instance'ından bağımsız tutuyoruz.
// disconnectSocket() + connectSocket() sonrasında kaybolmazlar.
const timerEventListeners = new Set();
const socketConnectedListeners = new Set();

let timerBindings = new Map();

function isCurrent(instance, identity) {
  return (
    socket === instance &&
    socketSessionIdentity === identity &&
    getTabSessionIdentity() === identity &&
    isTabSessionCurrent()
  );
}

function attachTimerListener(instance, identity, callback) {
  const guarded = (payload) => {
    if (isCurrent(instance, identity)) {
      callback(payload);
    }
  };

  timerBindings.set(callback, guarded);
  instance.on("timer-event", guarded);
}

let hasConnectedBefore = false;
let currentConnectionInfo = null;

let connectionWanted = false;
// Yalnız o anda global `socket` olarak tutulan instance'ın
// auth-retry state'ine işaret eder.
let socketAuthRetryState = null;

function notifySocketConnected(connectionInfo, instance, identity) {
  socketConnectedListeners.forEach((callback) => {
    Promise.resolve()
      .then(() => {
        if (
          socketConnectedListeners.has(callback) &&
          instance.connected &&
          isCurrent(instance, identity)
        ) {
          return callback(connectionInfo);
        }
      })
      .catch((err) => {
        console.error("[Socket] Connect callback hatası:", err);
      });
  });
}

function maybeRetryRejectedAuthSocket(
  instance,
  instanceSessionIdentity,
  authRetryState,
) {
  if (
    !connectionWanted ||
    socket !== instance ||
    socketSessionIdentity !== instanceSessionIdentity ||
    socketAuthRetryState !== authRetryState
  ) {
    return;
  }

  // Network/transport reconnect'i devam ediyorsa karışma.
  if (instance.connected || instance.active) {
    return;
  }

  const currentTabSessionIdentity = getTabSessionIdentity();

  const currentAccessToken = getAccessToken();

  const currentAccessIdentity = getTokenSessionIdentity(
    currentAccessToken,
    "access",
  );

  // Event/401 gelene kadar session değişmiş olabilir.
  if (
    !isTabSessionCurrent() ||
    currentTabSessionIdentity !== instanceSessionIdentity ||
    currentAccessIdentity !== instanceSessionIdentity
  ) {
    return;
  }

  if (!authRetryState.rejectedAuthToken) {
    return;
  }

  // Reddedilen token hâlâ güncelse yeni token yok.
  if (authRetryState.rejectedAuthToken === currentAccessToken) {
    return;
  }

  // Aynı yeni token'la yalnız bir manuel retry.
  if (authRetryState.manualRetryToken === currentAccessToken) {
    return;
  }

  authRetryState.manualRetryToken = currentAccessToken;

  authRetryState.rejectedAuthToken = null;

  instance.connect();
}

function scheduleTransientSocketRetry(
  instance,
  instanceSessionIdentity,
  authRetryState,
) {
  if (
    !connectionWanted ||
    socket !== instance ||
    socketSessionIdentity !== instanceSessionIdentity ||
    socketAuthRetryState !== authRetryState
  ) {
    return;
  }

  // Normal network/transport reconnect'ine karışma.
  if (instance.connected || instance.active) {
    return;
  }

  if (authRetryState.transientRetryTimer) {
    return;
  }

  const transientDelay =
    TRANSIENT_SOCKET_RETRY_DELAYS_MS[authRetryState.transientRetryAttempt];

  const usingRecoveryProbe = transientDelay == null;

  const delay = usingRecoveryProbe
    ? SOCKET_RECOVERY_PROBE_DELAY_MS
    : transientDelay;

  // 1s / 3s / 7s aşamasında sayacı ilerlet.
  // Bunlar bittikten sonra sayaç sabit kalır ve
  // 30 saniyelik recovery probe kullanılır.
  if (!usingRecoveryProbe) {
    authRetryState.transientRetryAttempt += 1;
  }

  authRetryState.transientRetryTimer = setTimeout(() => {
    authRetryState.transientRetryTimer = null;

    if (
      !connectionWanted ||
      socket !== instance ||
      socketSessionIdentity !== instanceSessionIdentity ||
      socketAuthRetryState !== authRetryState ||
      !isTabSessionCurrent() ||
      getTabSessionIdentity() !== instanceSessionIdentity
    ) {
      return;
    }

    if (instance.connected || instance.active) {
      return;
    }

    instance.connect();
  }, delay);
}

export function connectSocket() {
  const tabSessionIdentity = getTabSessionIdentity();

  if (!isTabSessionCurrent() || !tabSessionIdentity) {
    disconnectSocket();
    return null;
  }

  // Var olan socket yalnız aynı auth session'a aitse
  // tekrar kullanılabilir.
  if (socket) {
    if (socketSessionIdentity === tabSessionIdentity) {
      connectionWanted = true;

      // 503 bounded retry'ları bittikten sonra
      // uygulama bilinçli olarak tekrar connectSocket()
      // çağırırsa socket'i yeniden uyandırabilsin.
      if (
        !socket.connected &&
        !socket.active &&
        socketAuthRetryState?.lastConnectErrorStatus === 503
      ) {
        if (socketAuthRetryState.transientRetryTimer) {
          clearTimeout(socketAuthRetryState.transientRetryTimer);

          socketAuthRetryState.transientRetryTimer = null;
        }

        socketAuthRetryState.transientRetryAttempt = 0;

        socket.connect();
      }

      return socket;
    }

    // Örn. aynı sekmede A açıkken B login oldu.
    disconnectSocket();
  }

  connectionWanted = true;

  // Yeni auth session ise B'nin ilk bağlantısını
  // "reconnect" gibi göstermeyelim.
  //
  // Aynı auth session'da manuel disconnect/connect veya
  // network reconnect durumunda history korunur.
  if (connectionHistorySessionIdentity !== tabSessionIdentity) {
    hasConnectedBefore = false;
    currentConnectionInfo = null;
    connectionHistorySessionIdentity = tabSessionIdentity;
  }

  // KRİTİK:
  // Bu değer bu socket instance için değişmez.
  // Global socketSessionIdentity auth callback içinde
  // güvenlik kaynağı olarak kullanılmayacak.
  const instanceSessionIdentity = tabSessionIdentity;
  const authRetryState = {
    lastHandshakeToken: null,
    rejectedAuthToken: null,
    manualRetryToken: null,
    refreshAttemptToken: null,

    transientRetryAttempt: 0,
    transientRetryTimer: null,
    lastConnectErrorStatus: null,
  };
  const newSocket = io(SOCKET_URL, {
    autoConnect: false,
    auth: (callback) => {
      const currentTabSessionIdentity = getTabSessionIdentity();

      const accessToken = getAccessToken();

      const accessSessionIdentity = getTokenSessionIdentity(
        accessToken,
        "access",
      );

      // Bu socket instance hangi session için
      // oluşturulduysa yalnız o session'ın token'ını
      // kullanabilir.
      if (
        !isTabSessionCurrent() ||
        !currentTabSessionIdentity ||
        currentTabSessionIdentity !== instanceSessionIdentity ||
        accessSessionIdentity !== instanceSessionIdentity
      ) {
        // Bu handshake'de geçerli bir access token
        // gönderilmediğini state'e de yansıt.
        authRetryState.lastHandshakeToken = null;

        callback({
          token: null,
        });

        return;
      }

      // Bu bağlantı denemesinde gerçekten hangi
      // access token'ın gönderildiğini kaydet.
      // Sonradan connect_error 401 gelirse,
      // reddedilen token'ın hangisi olduğunu
      // buradan bileceğiz.
      authRetryState.lastHandshakeToken = accessToken;

      callback({
        token: accessToken,
      });
    },
  });

  socket = newSocket;
  socketSessionIdentity = instanceSessionIdentity;
  socketAuthRetryState = authRetryState;

  // Listener'ları bu instance'a bağla.
  timerBindings = new Map();

  timerEventListeners.forEach((callback) => {
    attachTimerListener(newSocket, instanceSessionIdentity, callback);
  });

  newSocket.on("connect_error", (error) => {
    // Eski socket'in gecikmiş hatası
    // yeni instance'a dokunamaz.
    if (
      socket !== newSocket ||
      socketSessionIdentity !== instanceSessionIdentity ||
      !connectionWanted
    ) {
      return;
    }

    const status = Number(error?.data?.status) || null;

    authRetryState.lastConnectErrorStatus = status;

    // Backend geçici olarak auth doğrulayamıyorsa
    // sınırlı manuel retry yap.
    if (status === 503) {
      scheduleTransientSocketRetry(
        newSocket,
        instanceSessionIdentity,
        authRetryState,
      );

      return;
    }

    // Network/transport veya başka hata:
    // Socket.IO'nun kendi davranışına bırak.
    if (status !== 401) {
      return;
    }

    // Bu 401 hangi handshake token'ına ait?
    authRetryState.rejectedAuthToken = authRetryState.lastHandshakeToken;

    // Eğer HTTP refresh 401'den ÖNCE tamamlandıysa,
    // current token artık farklıdır ve burada tek retry yapılır.
    maybeRetryRejectedAuthSocket(
      newSocket,
      instanceSessionIdentity,
      authRetryState,
    );

    void maybeRefreshRejectedAuthSocket(
      newSocket,
      instanceSessionIdentity,
      authRetryState,
    );

    async function maybeRefreshRejectedAuthSocket(
      instance,
      instanceSessionIdentity,
      authRetryState,
    ) {
      if (
        !connectionWanted ||
        socket !== instance ||
        socketSessionIdentity !== instanceSessionIdentity ||
        socketAuthRetryState !== authRetryState
      ) {
        return;
      }

      const rejectedToken = authRetryState.rejectedAuthToken;

      const currentAccessToken = getAccessToken();

      const currentRefreshToken = getRefreshToken();

      const currentTabIdentity = getTabSessionIdentity();

      if (
        !isTabSessionCurrent() ||
        !rejectedToken ||
        !currentAccessToken ||
        !currentRefreshToken ||
        currentTabIdentity !== instanceSessionIdentity ||
        getTokenSessionIdentity(currentAccessToken, "access") !==
          instanceSessionIdentity ||
        getTokenSessionIdentity(currentRefreshToken, "refresh") !==
          instanceSessionIdentity
      ) {
        return;
      }

      // Buraya yalnız reddedilen token hâlâ current ise geliriz.
      // Token zaten değiştiyse maybeRetryRejectedAuthSocket()
      // işi üstlenir.
      if (rejectedToken !== currentAccessToken) {
        return;
      }

      // Aynı bozuk/expired access token için yalnız
      // bir refresh başlat.
      if (authRetryState.refreshAttemptToken === currentAccessToken) {
        return;
      }

      authRetryState.refreshAttemptToken = currentAccessToken;

      const expectedGeneration = getAuthGeneration();

      const expectedRefreshToken = currentRefreshToken;

      const result = await refreshAccessToken(
        expectedGeneration,
        expectedRefreshToken,
      );

      // Await sırasında logout/login/socket değişmiş olabilir.
      if (
        socket !== instance ||
        socketSessionIdentity !== instanceSessionIdentity ||
        socketAuthRetryState !== authRetryState
      ) {
        return;
      }

      if (result.ok) {
        // Başarılı refresh kendi
        // AUTH_ACCESS_TOKEN_REFRESHED_EVENT'ini gönderir.
        // Retry oradan yapılır.
        return;
      }

      if (result.hardFail) {
        const cleared = await clearAuthSessionIfCurrent(
          expectedGeneration,
          expectedRefreshToken,
        );

        if (!cleared) {
          return;
        }

        window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT));

        window.dispatchEvent(new Event(AUTH_LOGIN_REQUIRED_EVENT));

        return;
      }

      // Network / 503 gibi geçici refresh hatasında
      // session'ı silme.
      // Aynı token ileride yeniden denenebilsin.
      authRetryState.refreshAttemptToken = null;
      // Socket middleware 401 sonrası otomatik reconnect yapmaz.
      // Mevcut bounded transient retry akışını kullanarak
      // aynı session için kontrollü biçimde yeniden dene.
      scheduleTransientSocketRetry(
        instance,
        instanceSessionIdentity,
        authRetryState,
      );
    }
  });

  newSocket.on("connect", () => {
    // Bu sırada yeni bir socket oluşturulduysa
    // eski instance global state'i değiştiremez.
    if (!isCurrent(newSocket, instanceSessionIdentity)) {
      if (socket === newSocket) {
        disconnectSocket();
      }

      return;
    }

    authRetryState.lastHandshakeToken = null;
    authRetryState.rejectedAuthToken = null;
    authRetryState.manualRetryToken = null;
    authRetryState.refreshAttemptToken = null;

    if (authRetryState.transientRetryTimer) {
      clearTimeout(authRetryState.transientRetryTimer);

      authRetryState.transientRetryTimer = null;
    }

    authRetryState.transientRetryAttempt = 0;
    authRetryState.lastConnectErrorStatus = null;

    const connectionInfo = {
      isReconnect: hasConnectedBefore,
    };

    hasConnectedBefore = true;
    currentConnectionInfo = connectionInfo;

    console.log(
      "[Socket] Bağlandı:",
      newSocket.id,
      "reconnect:",
      connectionInfo.isReconnect,
      "zaman:",
      new Date().toISOString(),
    );

    notifySocketConnected(connectionInfo, newSocket, instanceSessionIdentity);
  });

  newSocket.on("disconnect", (reason) => {
    // Eski socket'in gecikmiş disconnect'i
    // yeni socket'in connection state'ini silemez.
    if (socket !== newSocket) {
      return;
    }

    currentConnectionInfo = null;

    console.log(
      "[Socket] Bağlantı kesildi, sebep:",
      reason,
      "zaman:",
      new Date().toISOString(),
    );
  });

  newSocket.io.on("reconnect_attempt", (attempt) => {
    // Eski Manager instance'ından gelen callback'i yok say.
    if (!isCurrent(newSocket, instanceSessionIdentity)) {
      return;
    }

    console.log(
      "[Socket] Yeniden bağlanma denemesi:",
      attempt,
      "zaman:",
      new Date().toISOString(),
    );
  });

  newSocket.connect();

  return newSocket;
}

export function getSocket() {
  if (socket && !isCurrent(socket, socketSessionIdentity)) {
    disconnectSocket();
  }

  return socket;
}

export function onTimerEvent(callback) {
  if (!timerEventListeners.has(callback)) {
    timerEventListeners.add(callback);

    if (socket && socketSessionIdentity) {
      attachTimerListener(socket, socketSessionIdentity, callback);
    }
  }

  return () => {
    timerEventListeners.delete(callback);

    const guarded = timerBindings.get(callback);

    if (socket && guarded) {
      socket.off("timer-event", guarded);
    }

    timerBindings.delete(callback);
  };
}
export function onSocketConnected(callback) {
  socketConnectedListeners.add(callback);

  // Listener socket bağlandıktan sonra kaydedildiyse olayı kaçırma.
  if (socket?.connected && currentConnectionInfo) {
    Promise.resolve()
      .then(() => callback(currentConnectionInfo))
      .catch((err) => {
        console.error("[Socket] Connect callback hatası:", err);
      });
  }

  return () => {
    socketConnectedListeners.delete(callback);
  };
}

export function disconnectSocket() {
  connectionWanted = false;
  if (socketAuthRetryState?.transientRetryTimer) {
    clearTimeout(socketAuthRetryState.transientRetryTimer);
  }
  socketAuthRetryState = null;

  const oldSocket = socket;

  // Önce global instance'ı geçersiz kıl.
  socket = null;
  socketSessionIdentity = null;
  currentConnectionInfo = null;

  if (!oldSocket) {
    timerBindings = new Map();
    return;
  }

  for (const guarded of timerBindings.values()) {
    oldSocket.off("timer-event", guarded);
  }

  timerBindings = new Map();

  oldSocket.disconnect();
}

if (typeof window !== "undefined") {
  window.addEventListener(AUTH_LOCAL_LOGOUT_EVENT, () => {
    disconnectSocket();
  });
  window.addEventListener(AUTH_ACCESS_TOKEN_REFRESHED_EVENT, () => {
    const currentSocket = socket;
    const currentIdentity = socketSessionIdentity;
    const currentAuthRetryState = socketAuthRetryState;

    // Bilerek kapatılmış veya artık mevcut olmayan socket'i
    // refresh event'i yeniden açamaz.
    if (
      !connectionWanted ||
      !currentSocket ||
      !currentIdentity ||
      !currentAuthRetryState
    ) {
      return;
    }

    // Event geldikten sonra session/token değişmiş olabilir.
    // Retry kararı helper içinde güncel state tekrar okunarak verilir.
    maybeRetryRejectedAuthSocket(
      currentSocket,
      currentIdentity,
      currentAuthRetryState,
    );
  });
  // Aynı sekmede yeni login.
  window.addEventListener(AUTH_SESSION_CHANGED_EVENT, () => {
    if (socket && !isCurrent(socket, socketSessionIdentity)) {
      disconnectSocket();
    }
  });

  // Başka sekmede login/logout.
  window.addEventListener("storage", (event) => {
    if (event.key !== "refreshToken") {
      return;
    }

    if (!isTabSessionCurrent()) {
      disconnectSocket();
    }
  });
}
