import { PUBLIC_CATALOG } from "./game-data.js";
export { GameRoom } from "./game-room.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function makeGameCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join("");
}

function roomStub(env, code) {
  return env.GAME_ROOMS.getByName(code);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/catalog" && request.method === "GET") {
      return json(PUBLIC_CATALOG);
    }

    if (url.pathname === "/api/games" && request.method === "POST") {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = makeGameCode();
        const response = await roomStub(env, code).fetch("https://room/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code })
        });

        if (response.status === 409) {
          continue;
        }

        return response;
      }

      return json({ error: "Could not allocate a game code. Try again." }, 503);
    }

    const match = url.pathname.match(/^\/api\/games\/([A-Z0-9]{6})\/(join|ws)$/);

    if (match) {
      const [, code, action] = match;
      const stub = roomStub(env, code);

      if (action === "join" && request.method === "POST") {
        return stub.fetch("https://room/join", { method: "POST" });
      }

      if (action === "ws" && request.method === "GET") {
        const playerId = url.searchParams.get("playerId") || "";
        const headers = new Headers(request.headers);
        const target = new URL("https://room/ws");
        target.searchParams.set("playerId", playerId);
        return stub.fetch(new Request(target, { method: "GET", headers }));
      }
    }

    return json({ error: "Not found." }, 404);
  }
};
