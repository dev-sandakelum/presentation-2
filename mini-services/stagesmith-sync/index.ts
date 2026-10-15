import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const PORT = 3003;

const DECKS_ROOT =
  process.env.DECKS_ROOT ||
  path.resolve(process.cwd(), "..", "..", "decks");

const httpServer = createServer();
const io = new Server(httpServer, {
  // DO NOT change the path — the gateway forwards on it
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingInterval: 25000,
  pingTimeout: 60000,
});

/* ------------------------------------------------------------------ */
/* Room state (plan §5.4)                                              */
/* ------------------------------------------------------------------ */

interface SlideRef {
  id: string;
  label: string;
}

interface Room {
  deckId: string;
  slideId: string | null;
  index: number;
  step: number;
  steps: number;
  order: SlideRef[];
  stepsMap: Map<string, number>;
  token: string | null;
  remotes: Map<string, { label: string }>;
  updatedAt: number;
}

const rooms = new Map<string, Room>();

function roomState(room: Room) {
  return {
    deckId: room.deckId,
    slideId: room.slideId,
    index: room.index,
    step: room.step,
    steps: room.steps,
    order: room.order.map((s) => ({ id: s.id, label: s.label })),
    updatedAt: room.updatedAt,
  };
}

function getOrCreateRoom(deckId: string): Room {
  let room = rooms.get(deckId);
  if (!room) {
    room = {
      deckId,
      slideId: null,
      index: 0,
      step: 0,
      steps: 1,
      order: [],
      stepsMap: new Map(),
      token: null,
      remotes: new Map(),
      updatedAt: Date.now(),
    };
    rooms.set(deckId, room);
  }
  return room;
}

function clampToRoom(room: Room) {
  if (room.order.length === 0) return;
  room.index = Math.max(0, Math.min(room.index, room.order.length - 1));
  const cur = room.order[room.index];
  if (cur && room.slideId !== cur.id) {
    room.slideId = cur.id;
    room.step = 0;
    room.steps = room.stepsMap.get(cur.id) || 1;
  }
}

function broadcastState(room: Room) {
  room.updatedAt = Date.now();
  io.to(`deck:${room.deckId}`).emit("state", roomState(room));
}

function broadcastPresence(room: Room) {
  io.to(`deck:${room.deckId}`).emit("presence", {
    deckId: room.deckId,
    remotes: room.remotes.size,
  });
}

/* ------------------------------------------------------------------ */
/* Nav resolution (plan: server resolves steps, then slides)          */
/* ------------------------------------------------------------------ */

function nav(room: Room, dir: "next" | "prev") {
  const stepsFor = (id: string | null) => (id ? room.stepsMap.get(id) || 1 : 1);
  if (dir === "next") {
    if (room.step < stepsFor(room.slideId) - 1) {
      room.step += 1;
    } else if (room.index < room.order.length - 1) {
      room.index += 1;
      room.slideId = room.order[room.index].id;
      room.step = 0;
      room.steps = stepsFor(room.slideId);
    } else {
      return; // at the end
    }
  } else {
    if (room.step > 0) {
      room.step -= 1;
    } else if (room.index > 0) {
      room.index -= 1;
      room.slideId = room.order[room.index].id;
      const prevSteps = stepsFor(room.slideId);
      room.step = Math.max(0, prevSteps - 1);
      room.steps = prevSteps;
    } else {
      return; // at the start
    }
  }
  broadcastState(room);
}

/* ------------------------------------------------------------------ */
/* Connections                                                         */
/* ------------------------------------------------------------------ */

io.on("connection", (socket) => {
  let joinedDeck: string | null = null;
  let role: "display" | "remote" | "editor" | null = null;

  socket.on(
    "join",
    (data: { deckId: string; role?: string; token?: string; slides?: SlideRef[]; label?: string }) => {
      const deckId = String(data?.deckId || "");
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(deckId)) {
        socket.emit("error", { message: "Invalid deck id" });
        return;
      }
      const room = getOrCreateRoom(deckId);
      joinedDeck = deckId;
      role = (data.role as "display" | "remote" | "editor") || "editor";
      socket.join(`deck:${deckId}`);

      // slide order may arrive from the first client (display or editor)
      if (Array.isArray(data.slides) && data.slides.length) {
        const next = data.slides.filter(
          (s) => s && typeof s.id === "string" && typeof s.label === "string",
        );
        const same = next.length === room.order.length && next.every((s, i) => s.id === room.order[i]?.id);
        if (!same) {
          room.order = next;
          if (room.slideId === null) {
            room.slideId = room.order[0]?.id ?? null;
            room.index = 0;
            room.step = 0;
            room.steps = stepsOf(room, room.slideId);
          } else {
            const idx = room.order.findIndex((s) => s.id === room.slideId);
            if (idx >= 0) {
              room.index = idx;
            } else {
              room.index = 0;
              room.slideId = room.order[0]?.id ?? null;
              room.step = 0;
            }
            room.steps = stepsOf(room, room.slideId);
          }
        }
      }
      clampToRoom(room);

      if (role === "display") {
        if (!room.token) room.token = crypto.randomBytes(6).toString("hex");
        socket.emit("joined", { state: roomState(room), token: room.token });
      } else if (role === "remote") {
        if (!data.token || data.token !== room.token) {
          socket.emit("error", { message: "Invalid or missing remote token" });
          socket.leave(`deck:${deckId}`);
          joinedDeck = null;
          return;
        }
        room.remotes.set(socket.id, { label: String(data.label || "Phone") });
        broadcastPresence(room);
        socket.emit("joined", { state: roomState(room) });
      } else {
        // editor / dashboard — sync only
        socket.emit("joined", { state: roomState(room), token: room.token ?? null });
      }

      broadcastPresence(room);
    },
  );

  const requireControl = (token?: string): boolean => {
    if (!joinedDeck) return false;
    const room = rooms.get(joinedDeck);
    if (!room) return false;
    // display (presenter) may always control; remotes and editors need the token
    if (role === "display") return true;
    return Boolean(token && token === room.token);
  };

  socket.on("set-slide", (data: { slideId: string; step?: number; token?: string }) => {
    if (!joinedDeck) return;
    const room = rooms.get(joinedDeck);
    if (!room || !requireControl(data?.token)) return;
    const idx = room.order.findIndex((s) => s.id === data.slideId);
    if (idx < 0) return;
    room.index = idx;
    room.slideId = data.slideId;
    room.step = Math.max(0, data.step ?? 0);
    room.steps = room.stepsMap.get(room.slideId) || 1;
    broadcastState(room);
  });

  socket.on("nav", (data: { dir: "next" | "prev"; token?: string }) => {
    if (!joinedDeck) return;
    const room = rooms.get(joinedDeck);
    if (!room || !requireControl(data?.token)) return;
    nav(room, data.dir === "prev" ? "prev" : "next");
  });

  socket.on("report-steps", (data: { slideId: string; steps: number }) => {
    if (!joinedDeck) return;
    const room = rooms.get(joinedDeck);
    if (!room) return;
    const n = Math.max(1, Math.min(50, Number(data.steps) || 1));
    room.stepsMap.set(String(data.slideId), n);
    if (room.slideId === data.slideId) {
      room.steps = n;
      // clamp current step
      if (room.step > n - 1) room.step = n - 1;
    }
  });

  socket.on("set-ui", (data: { qr?: boolean; overview?: boolean; token?: string }) => {
    if (!joinedDeck) return;
    const room = rooms.get(joinedDeck);
    if (!room || !requireControl(data?.token)) return;
    io.to(`deck:${joinedDeck}`).emit("ui", { qr: data.qr, overview: data.overview });
  });

  socket.on("sync-deck", (data: { slides: SlideRef[] }) => {
    // display re-syncs order after edits (slides added/removed)
    if (!joinedDeck) return;
    const room = rooms.get(joinedDeck);
    if (!room || role !== "display") return;
    if (Array.isArray(data.slides) && data.slides.length) {
      room.order = data.slides.filter((s) => s && s.id);
      clampToRoom(room);
    }
  });

  socket.on("ping", () => socket.emit("pong", { t: Date.now() }));

  socket.on("disconnect", () => {
    if (joinedDeck) {
      const room = rooms.get(joinedDeck);
      if (room && room.remotes.has(socket.id)) {
        room.remotes.delete(socket.id);
        broadcastPresence(room);
      }
    }
  });
});

function stepsOf(room: Room, slideId: string | null): number {
  return (slideId && room.stepsMap.get(slideId)) || 1;
}

/* ------------------------------------------------------------------ */
/* Folder watch → deck-updated (plan §5.4 / §7 live edit)              */
/* ------------------------------------------------------------------ */

const pending = new Map<string, number>();
function queueDeckUpdate(deckId: string) {
  pending.set(deckId, Date.now());
}

function flushDeckUpdates() {
  const now = Date.now();
  for (const [deckId, at] of pending) {
    if (now - at > 300) {
      pending.delete(deckId);
      const room = rooms.get(deckId);
      if (room) {
        io.to(`deck:${deckId}`).emit("deck-updated", { deckId, at: now });
      }
    }
  }
}
setInterval(flushDeckUpdates, 350);

try {
  fs.watch(DECKS_ROOT, { recursive: true }, (_event, filename) => {
    const f = String(filename || "");
    if (f.startsWith(".") || f.includes(".stagesmith") || f.includes(".tmp-")) return;
    const deckId = f.split(/[\\/]/)[0];
    if (deckId) queueDeckUpdate(deckId);
  });
  console.log(`Watching ${DECKS_ROOT} for live deck changes`);
} catch (e) {
  console.warn("fs.watch recursive unavailable, falling back to scan:", (e as Error).message);
}

httpServer.listen(PORT, () => {
  console.log(`Stagesmith sync service running on port ${PORT}`);
});

process.on("SIGTERM", () => {
  httpServer.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  httpServer.close(() => process.exit(0));
});
