import { DurableObject } from "cloudflare:workers";
import { CARD_MAP, CHARACTER, DECK_RULES, validateDeck } from "./game-data.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function shuffle(cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const j = random[0] % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function safeDeckName(value) {
  const name = String(value || "Deck").trim().slice(0, 32);
  return name || "Deck";
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.room = null;
    this.loaded = this.ctx.blockConcurrencyWhile(async () => {
      this.room = (await this.ctx.storage.get("room")) || null;
    });
  }

  async fetch(request) {
    await this.loaded;
    const url = new URL(request.url);

    if (url.pathname === "/create" && request.method === "POST") {
      if (this.room) {
        return json({ error: "Game code already exists." }, 409);
      }

      const { code } = await request.json();
      const player = this.makePlayer(1);

      this.room = {
        code,
        phase: "lobby",
        turn: 0,
        turnPlayerId: null,
        winnerId: null,
        players: [player]
      };

      await this.save();
      return json({ code, playerId: player.id }, 201);
    }

    if (url.pathname === "/join" && request.method === "POST") {
      if (!this.room) {
        return json({ error: "Game not found." }, 404);
      }

      if (this.room.phase !== "lobby") {
        return json({ error: "Game already started." }, 409);
      }

      if (this.room.players.length >= 2) {
        return json({ error: "Lobby is full." }, 409);
      }

      const player = this.makePlayer(2);
      this.room.players.push(player);
      await this.save();
      await this.broadcast();
      return json({ code: this.room.code, playerId: player.id }, 200);
    }

    if (url.pathname === "/ws" && request.method === "GET") {
      if (!this.room) {
        return json({ error: "Game not found." }, 404);
      }

      if (request.headers.get("Upgrade") !== "websocket") {
        return json({ error: "WebSocket upgrade required." }, 426);
      }

      const playerId = url.searchParams.get("playerId");
      if (!this.player(playerId)) {
        return json({ error: "Invalid player." }, 403);
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ playerId });
      this.send(server, this.viewFor(playerId));
      return new Response(null, { status: 101, webSocket: client });
    }

    return json({ error: "Not found." }, 404);
  }

  async webSocketMessage(ws, rawMessage) {
    if (typeof rawMessage !== "string") {
      this.sendError(ws, "Only text messages are supported.");
      return;
    }

    let message;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      this.sendError(ws, "Invalid message.");
      return;
    }

    const attachment = ws.deserializeAttachment();
    const playerId = attachment?.playerId;
    const player = this.player(playerId);

    if (!player) {
      this.sendError(ws, "Player no longer exists.");
      return;
    }

    try {
      if (message.type === "select_deck") {
        this.selectDeck(player, message.deck);
      } else if (message.type === "ready") {
        this.setReady(player, Boolean(message.ready));
      } else if (message.type === "play_card") {
        this.playCard(player, message.cardIndex);
      } else if (message.type === "end_turn") {
        this.endTurn(player);
      } else {
        throw new Error("Unknown action.");
      }

      await this.save();
      await this.broadcast();
    } catch (error) {
      this.sendError(ws, error instanceof Error ? error.message : "Action failed.");
    }
  }

  webSocketClose() {}

  webSocketError() {}

  makePlayer(number) {
    return {
      id: crypto.randomUUID(),
      name: "Player " + number,
      characterId: CHARACTER.id,
      ready: false,
      deckName: null,
      selectedDeck: null,
      deck: [],
      hand: [],
      health: CHARACTER.maxHealth,
      armor: 0,
      mana: 0,
      maxMana: 0
    };
  }

  player(playerId) {
    return this.room?.players.find((item) => item.id === playerId) || null;
  }

  opponent(playerId) {
    return this.room?.players.find((item) => item.id !== playerId) || null;
  }

  selectDeck(player, deck) {
    if (this.room.phase !== "lobby") {
      throw new Error("Decks can only be changed in the lobby.");
    }

    const validation = validateDeck(deck);
    if (!validation.ok) {
      throw new Error(validation.message);
    }

    player.deckName = safeDeckName(deck.name);
    player.selectedDeck = [...deck.cards];
    player.ready = false;
  }

  setReady(player, ready) {
    if (this.room.phase !== "lobby") {
      throw new Error("The game has already started.");
    }

    if (ready && !player.selectedDeck) {
      throw new Error("Choose a deck first.");
    }

    player.ready = ready;

    if (this.room.players.length === 2 && this.room.players.every((item) => item.ready)) {
      this.startGame();
    }
  }

  startGame() {
    this.room.phase = "playing";
    this.room.turn = 1;
    this.room.winnerId = null;

    for (const player of this.room.players) {
      player.health = CHARACTER.maxHealth;
      player.armor = 0;
      player.mana = 0;
      player.maxMana = 0;
      player.hand = [];
      player.deck = shuffle(player.selectedDeck);

      for (let i = 0; i < DECK_RULES.startingHand; i += 1) {
        this.draw(player);
      }
    }

    const firstPlayer = this.room.players[0];
    firstPlayer.maxMana = 1;
    firstPlayer.mana = 1;
    this.room.turnPlayerId = firstPlayer.id;
  }

  playCard(player, cardIndex) {
    if (this.room.phase !== "playing") {
      throw new Error("The game is not in progress.");
    }

    if (this.room.turnPlayerId !== player.id) {
      throw new Error("It is not your turn.");
    }

    if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= player.hand.length) {
      throw new Error("Invalid card.");
    }

    const cardId = player.hand[cardIndex];
    const card = CARD_MAP.get(cardId);

    if (!card) {
      throw new Error("Unknown card.");
    }

    if (card.cost > player.mana) {
      throw new Error("Not enough mana.");
    }

    player.mana -= card.cost;
    player.hand.splice(cardIndex, 1);
    player.deck.push(cardId);

    if (card.effect.type === "armor") {
      player.armor += card.effect.value;
      return;
    }

    if (card.effect.type === "damage") {
      const enemy = this.opponent(player.id);
      if (!enemy) {
        throw new Error("Opponent missing.");
      }

      this.dealDamage(enemy, card.effect.value);
      if (enemy.health <= 0) {
        this.room.phase = "finished";
        this.room.winnerId = player.id;
        this.room.turnPlayerId = null;
      }
    }
  }

  endTurn(player) {
    if (this.room.phase !== "playing") {
      throw new Error("The game is not in progress.");
    }

    if (this.room.turnPlayerId !== player.id) {
      throw new Error("It is not your turn.");
    }

    const nextPlayer = this.opponent(player.id);
    if (!nextPlayer) {
      throw new Error("Opponent missing.");
    }

    this.room.turn += 1;
    this.room.turnPlayerId = nextPlayer.id;
    nextPlayer.maxMana = Math.min(DECK_RULES.maxMana, nextPlayer.maxMana + 1);
    nextPlayer.mana = nextPlayer.maxMana;
    this.draw(nextPlayer);
  }

  dealDamage(player, amount) {
    const absorbed = Math.min(player.armor, amount);
    player.armor -= absorbed;
    player.health = Math.max(0, player.health - (amount - absorbed));
  }

  draw(player) {
    if (player.deck.length > 0) {
      player.hand.push(player.deck.shift());
    }
  }

  async save() {
    await this.ctx.storage.put("room", this.room);
  }

  async broadcast() {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment();
      const playerId = attachment?.playerId;
      if (this.player(playerId)) {
        this.send(ws, this.viewFor(playerId));
      }
    }
  }

  viewFor(playerId) {
    const you = this.player(playerId);
    const enemy = this.opponent(playerId);

    return {
      type: "state",
      room: {
        code: this.room.code,
        phase: this.room.phase,
        turn: this.room.turn,
        turnPlayerId: this.room.turnPlayerId,
        winnerId: this.room.winnerId,
        players: this.room.players.map((player) => ({
          id: player.id,
          name: player.name,
          ready: player.ready,
          deckName: player.deckName
        })),
        you: you ? {
          id: you.id,
          name: you.name,
          ready: you.ready,
          deckName: you.deckName,
          health: you.health,
          armor: you.armor,
          mana: you.mana,
          maxMana: you.maxMana,
          hand: [...you.hand],
          deckCount: you.deck.length
        } : null,
        opponent: enemy ? {
          id: enemy.id,
          name: enemy.name,
          ready: enemy.ready,
          deckName: enemy.deckName,
          health: enemy.health,
          armor: enemy.armor,
          mana: enemy.mana,
          maxMana: enemy.maxMana,
          handCount: enemy.hand.length,
          deckCount: enemy.deck.length
        } : null
      }
    };
  }

  send(ws, message) {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Disconnected sockets are cleaned up by the runtime.
    }
  }

  sendError(ws, message) {
    this.send(ws, { type: "error", message });
  }
}
