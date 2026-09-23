import { io } from "socket.io-client";
import { getUser, getAccessToken } from "./backendSync";

const SOCKET_URL = "https://multi-stopwatch-backend.onrender.com";

let socket = null;

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
  if (socket) return socket;

  socket = io(SOCKET_URL, {
    auth: (callback) => {
      callback({
        token: getAccessToken(),
      });
    },
  });

  // Yeni socket oluşturulduğunda kayıtlı timer listener'larını tekrar bağla.
  timerEventListeners.forEach((callback) => {
    socket.on("timer-event", callback);
  });

  socket.on("connect", () => {
    const connectionInfo = {
      isReconnect: hasConnectedBefore,
    };

    hasConnectedBefore = true;
    currentConnectionInfo = connectionInfo;

    console.log(
      "[Socket] Bağlandı:",
      socket.id,
      "reconnect:",
      connectionInfo.isReconnect,
      "zaman:",
      new Date().toISOString(),
    );

    const user = getUser();

    notifySocketConnected(connectionInfo);
  });

  socket.on("disconnect", (reason) => {
    currentConnectionInfo = null;

    console.log(
      "[Socket] Bağlantı kesildi, sebep:",
      reason,
      "zaman:",
      new Date().toISOString(),
    );
  });

  socket.io.on("reconnect_attempt", (attempt) => {
    console.log(
      "[Socket] Yeniden bağlanma denemesi:",
      attempt,
      "zaman:",
      new Date().toISOString(),
    );
  });

  return socket;
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
    socket.disconnect();
    socket = null;
    currentConnectionInfo = null;
  }
}
