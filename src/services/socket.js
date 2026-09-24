import { io } from "socket.io-client";
import {
  AUTH_SESSION_CHANGED_EVENT,
  AUTH_LOCAL_LOGOUT_EVENT,
  getAccessToken,
  getTabSessionIdentity,
  getTokenSessionIdentity,
  isTabSessionCurrent,
} from "./backendSync";

const SOCKET_URL = "https://multi-stopwatch-backend.onrender.com";

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

let hasConnectedBefore = false;
let currentConnectionInfo = null;

function notifySocketConnected(connectionInfo) {
  socketConnectedListeners.forEach((callback) => {
    Promise.resolve()
      .then(() => callback(connectionInfo))
      .catch((err) => {
        console.error("[Socket] Connect callback hatası:", err);
      });
  });
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
      return socket;
    }

    // Örn. aynı sekmede A açıkken B login oldu.
    disconnectSocket();
  }

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

  const newSocket = io(SOCKET_URL, {
    auth: (callback) => {
      const currentTabSessionIdentity = getTabSessionIdentity();

      const accessToken = getAccessToken();

      const accessSessionIdentity = getTokenSessionIdentity(
        accessToken,
        "access",
      );

      // Örneğin:
      //
      // Eski socket = A
      // Yeni login = B
      //
      // Bu callback geç çalışsa bile
      // instanceSessionIdentity hâlâ A'dır.
      // Dolayısıyla B token'ı eski A socket'ine gidemez.
      if (
        !isTabSessionCurrent() ||
        !currentTabSessionIdentity ||
        currentTabSessionIdentity !== instanceSessionIdentity ||
        accessSessionIdentity !== instanceSessionIdentity
      ) {
        callback({
          token: null,
        });

        return;
      }

      callback({
        token: accessToken,
      });
    },
  });

  socket = newSocket;
  socketSessionIdentity = instanceSessionIdentity;

  // Listener'ları bu instance'a bağla.
  timerEventListeners.forEach((callback) => {
    newSocket.on("timer-event", callback);
  });

  newSocket.on("connect", () => {
    // Bu sırada yeni bir socket oluşturulduysa
    // eski instance global state'i değiştiremez.
    if (socket !== newSocket) {
      return;
    }

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

    notifySocketConnected(connectionInfo);
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
    if (socket !== newSocket) {
      return;
    }

    console.log(
      "[Socket] Yeniden bağlanma denemesi:",
      attempt,
      "zaman:",
      new Date().toISOString(),
    );
  });

  return newSocket;
}

export function getSocket() {
  return socket;
}

export function onTimerEvent(callback) {
  if (!timerEventListeners.has(callback)) {
    timerEventListeners.add(callback);

    if (socket) {
      socket.on("timer-event", callback);
    }
  }

  return () => {
    timerEventListeners.delete(callback);

    if (socket) {
      socket.off("timer-event", callback);
    }
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
  if (socket) {
    const oldSocket = socket;

    // Eski workspace event'leri session değişiminden
    // sonra UI listener'larına ulaşmasın.
    timerEventListeners.forEach((callback) => {
      oldSocket.off("timer-event", callback);
    });

    // Önce global referansı geçersiz kıl.
    // Böylece gecikmiş oldSocket callback'leri
    // socket !== oldSocket kontrolüne takılır.
    socket = null;
    socketSessionIdentity = null;
    currentConnectionInfo = null;

    oldSocket.disconnect();
  } else {
    socketSessionIdentity = null;
    currentConnectionInfo = null;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener(AUTH_LOCAL_LOGOUT_EVENT, () => {
    disconnectSocket();
  });
  // Aynı sekmede yeni login.
  window.addEventListener(AUTH_SESSION_CHANGED_EVENT, () => {
    const tabSessionIdentity = getTabSessionIdentity();

    if (socket && socketSessionIdentity !== tabSessionIdentity) {
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
