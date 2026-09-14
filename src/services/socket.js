import { io } from "socket.io-client";
import { getUser } from "./backendSync";

const SOCKET_URL = "https://multi-stopwatch-backend.onrender.com";

let socket = null;

// onTimerEvent bazen connectSocket()'tan ÖNCE çağrılabiliyor
// (Pinia store modül seviyesinde kurulurken, App.vue'nun onMounted'ı
// henüz çalışmamış olabilir — component mount sırası garantisi yok).
// Bu durumda dinleyiciyi burada biriktirip, socket kurulunca hepsini bağlıyoruz.
const pendingListeners = [];

export function connectSocket() {
  if (socket) return socket;

  socket = io(SOCKET_URL);

  socket.on("connect", () => {
    console.log("[Socket] Bağlandı:", socket.id);

    const user = getUser();
    if (user?.workspace_id) {
      socket.emit("join-workspace", user.workspace_id);
    }
  });

  socket.on("disconnect", () => {
    console.log("[Socket] Bağlantı kesildi");
  });

  // Socket kurulmadan önce kaydedilmiş dinleyicileri şimdi gerçek socket'e bağla
  pendingListeners.forEach((cb) => socket.on("timer-event", cb));
  pendingListeners.length = 0;

  return socket;
}

export function getSocket() {
  return socket;
}

export function emitTimerEvent(event, data) {
  const user = getUser();
  if (!socket || !user?.workspace_id) return;

  socket.emit("timer-event", {
    workspaceId: user.workspace_id,
    event,
    data,
  });
}

export function onTimerEvent(callback) {
  if (!socket) {
    // Socket henüz yok — dinleyiciyi kuyruğa al, kaybetme
    pendingListeners.push(callback);
    return;
  }
  socket.on("timer-event", callback);
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}