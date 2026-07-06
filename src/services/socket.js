import { io } from "socket.io-client";
import { getUser } from "./backendSync";

const SOCKET_URL = "https://multi-stopwatch-backend.onrender.com";

let socket = null;

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
  if (!socket) return;
  socket.on("timer-event", callback);
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}