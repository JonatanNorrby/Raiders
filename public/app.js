const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

const DECK_STORAGE_KEY = "deckborn.decks.v1";

let catalog = null;
let decks = [];
let socket = null;
let session = null;
let room = null;
let selectedLobbyDeckId = null;
let selectedLobbyItemId = null;
let editingDeck = null;

boot();

async function boot() {
  try {
    const response = await fetch("/api/catalog");
    if (!response.ok) throw new Error("Could not load game data.");
    catalog = await response.json();
    decks = loadDecks();
    ensureStarterDeck();
    renderHome();
  } catch (error) {
    app.innerHTML = '<div class="panel">Failed to load Deckborn.</div>';
    showToast(error.message);
  }
}

function loadDecks() {
  try {
    const value = JSON.parse(localStorage.getItem(DECK_STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveDecks() {
  localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(decks));
}

function ensureStarterDeck() {
  if (decks.length > 0) return;

  decks = [{
    id: crypto.randomUUID(),
    name: "Starter Deck",
    cards: [
      "quick-strike", "quick-strike", "quick-strike", "quick-strike",
      "iron-guard", "iron-guard",
      "firebomb", "firebomb"
    ]
  }];
  saveDecks();
}

function leaveSession() {
  if (socket) socket.close();
  socket = null;
  session = null;
  room = null;
  selectedLobbyDeckId = null;
  selectedLobbyItemId = null;
  document.body.classList.remove("game-active");
}

function renderHome() {
  editingDeck = null;
  document.body.classList.add("main-menu-active");
  app.innerHTML = `
    <section class="menu">
      <img class="menu-logo" src="/assets/ui/logo.png" alt="Deckborn">
      <div class="stack menu-actions">
        <button class="button primary" id="play-game">Play</button>
        <button class="button" id="build-decks">Build Decks</button>
      </div>
    </section>`;

  document.querySelector("#play-game").onclick = renderPlay;
  document.querySelector("#build-decks").onclick = () => {
    document.body.classList.remove("main-menu-active");
    renderDeckBuilder();
  };
}

function renderPlay() {
  document.body.classList.add("main-menu-active");
  app.innerHTML = `
    <section class="menu play-menu">
      <h2>Play</h2>
      <div class="stack menu-actions">
        <button class="button primary" id="create-lobby">Create New Lobby</button>
        <div class="play-divider"><span>or join existing</span></div>
        <form id="join-form" class="stack">
          <input class="text-input" id="game-code" maxlength="6" autocomplete="off" placeholder="Game code" required>
          <button class="button" type="submit">Join Lobby</button>
        </form>
        <button class="button" id="play-back" type="button">Back</button>
      </div>
    </section>`;

  document.querySelector("#create-lobby").onclick = createGame;
  document.querySelector("#play-back").onclick = renderHome;
  document.querySelector("#join-form").onsubmit = async (event) => {
    event.preventDefault();
    const code = document.querySelector("#game-code").value.trim().toUpperCase();
    if (code.length !== 6) {
      showToast("Enter a six-character game code.");
      return;
    }

    try {
      const response = await fetch("/api/games/" + encodeURIComponent(code) + "/join", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not join game.");
      document.body.classList.remove("main-menu-active");
      enterLobby(data.code, data.playerId);
    } catch (error) {
      showToast(error.message);
    }
  };
}

async function createGame() {
  try {
    const response = await fetch("/api/games", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start game.");
    enterLobby(data.code, data.playerId);
  } catch (error) {
    showToast(error.message);
  }
}

function enterLobby(code, playerId) {
  session = { code, playerId };
  selectedLobbyDeckId = decks[0]?.id || null;
  selectedLobbyItemId = catalog.items[0]?.id || null;
  room = null;
  renderLobby();
  connectSocket();
}

function connectSocket() {
  if (!session) return;

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(protocol + "//" + location.host + "/api/games/" + session.code + "/ws?playerId=" + encodeURIComponent(session.playerId));

  socket.onopen = () => {
    const deck = decks.find((item) => item.id === selectedLobbyDeckId);
    if (deck) send({ type: "select_deck", deck });
    if (selectedLobbyItemId) send({ type: "select_item", itemId: selectedLobbyItemId });
  };

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "error") {
      showToast(message.message);
      return;
    }

    if (message.type === "state") {
      const previousRoom = room;
      room = message.room;

      if (
        previousRoom?.phase === "playing" &&
        room.phase === "playing" &&
        room.you?.items?.length > previousRoom.you?.items?.length
      ) {
        const gainedId = room.you.items.find((id) => !previousRoom.you.items.includes(id)) || room.you.items.at(-1);
        const gainedItem = catalog.items.find((item) => item.id === gainedId);
        showToast(gainedItem ? "New item: " + gainedItem.name : "You gained a new item.");
      }

      if (room.phase === "lobby") renderLobby();
      else renderGame();
    }
  };

  socket.onclose = () => {
    if (session) showToast("Disconnected from game.");
  };
}

function send(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showToast("Not connected.");
    return;
  }
  socket.send(JSON.stringify(message));
}

function renderLobby() {
  document.body.classList.remove("main-menu-active");
  const players = room?.players || [];
  const deckOptions = decks.map((deck) => `
    <option value="${escapeHtml(deck.id)}" ${deck.id === selectedLobbyDeckId ? "selected" : ""}>${escapeHtml(deck.name)}</option>`).join("");
  const itemOptions = catalog.items.map((item) => `
    <option value="${escapeHtml(item.id)}" ${item.id === selectedLobbyItemId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("");
  const selectedItem = catalog.items.find((item) => item.id === selectedLobbyItemId);

  const playerSlots = [0, 1].map((index) => {
    const player = players[index];
    return `
      <div class="player-slot ${player?.ready ? "ready" : ""}">
        <strong>${player ? escapeHtml(player.name) : "Waiting for player…"}</strong>
        <div class="muted">${player?.ready ? "Ready" : player ? "Not ready" : ""}</div>
      </div>`;
  }).join("");

  app.innerHTML = `
    <section class="panel">
      <div class="section-title">
        <div>
          <div class="muted">Game code</div>
          <div class="game-code">${escapeHtml(session?.code || "")}</div>
        </div>
        <button class="button" id="leave-lobby">Leave</button>
      </div>

      <div class="lobby-grid">${playerSlots}</div>

      <div class="panel deck-editor-card">
        <h3>Your loadout</h3>
        <div class="lobby-loadout">
          <label>
            <span class="muted">Deck</span>
            <select class="select" id="lobby-deck">${deckOptions}</select>
          </label>
          <label>
            <span class="muted">Starter item</span>
            <select class="select" id="lobby-item">${itemOptions}</select>
          </label>
        </div>
        <p class="muted item-description">${selectedItem ? escapeHtml(selectedItem.text) : "Choose a starter item."}</p>
        <button class="button primary" id="ready-button" ${!room?.you?.deckName || !room?.you?.selectedItemId ? "disabled" : ""}>${room?.you?.ready ? "Unready" : "Ready"}</button>
        <p class="muted">Both players must choose a deck and a private starter item, then press Ready.</p>
      </div>
    </section>`;

  document.querySelector("#leave-lobby").onclick = () => {
    leaveSession();
    renderHome();
  };

  const deckSelect = document.querySelector("#lobby-deck");
  deckSelect.onchange = () => {
    selectedLobbyDeckId = deckSelect.value;
    const deck = decks.find((item) => item.id === selectedLobbyDeckId);
    if (deck) send({ type: "select_deck", deck });
  };

  const itemSelect = document.querySelector("#lobby-item");
  itemSelect.onchange = () => {
    selectedLobbyItemId = itemSelect.value;
    send({ type: "select_item", itemId: selectedLobbyItemId });
  };

  document.querySelector("#ready-button").onclick = () => {
    send({ type: "ready", ready: !room?.you?.ready });
  };
}

function renderDeckBuilder() {
  document.body.classList.remove("main-menu-active");
  if (!editingDeck) {
    editingDeck = cloneDeck(decks[0] || { id: crypto.randomUUID(), name: "New Deck", cards: [] });
  }

  const counts = countCards(editingDeck.cards);
  const savedDeckButtons = decks.map((deck) => `
    <button class="button deck-choice" data-deck-id="${escapeHtml(deck.id)}">${escapeHtml(deck.name)}</button>`).join("");

  const pool = catalog.cards.map((card) => {
    const count = counts.get(card.id) || 0;
    const addDisabled = count >= catalog.deckRules.maxCopies || editingDeck.cards.length >= catalog.deckRules.size;
    return `
      <div class="pool-row">
        <div>
          <strong>${escapeHtml(card.name)}</strong>
          <div class="muted">${card.cost} mana · ${escapeHtml(card.text)}</div>
        </div>
        <div class="small-actions">
          <span class="count">${count} / ${catalog.deckRules.maxCopies}</span>
          <button class="small-button remove-card" data-card-id="${card.id}" ${count === 0 ? "disabled" : ""}>−</button>
          <button class="small-button add-card" data-card-id="${card.id}" ${addDisabled ? "disabled" : ""}>+</button>
        </div>
      </div>`;
  }).join("");

  app.innerHTML = `
    <section class="panel">
      <div class="section-title">
        <div>
          <h1>Build Decks</h1>
          <div class="muted">Saved locally and reusable across games.</div>
        </div>
        <div class="inline">
          <button class="button" id="back-main-menu">Back to Main Menu</button>
          <button class="button" id="new-deck">New Deck</button>
        </div>
      </div>

      <div class="deck-builder">
        <div>
          <h3>Saved Decks</h3>
          <div class="deck-list">${savedDeckButtons}</div>
        </div>

        <div>
          <h3>Edit Deck</h3>
          <input class="text-input" id="deck-name" maxlength="32" value="${escapeHtml(editingDeck.name)}">
          <p class="muted">${editingDeck.cards.length} / ${catalog.deckRules.size} cards</p>
          <div class="card-pool">${pool}</div>
          <div class="inline deck-editor-card">
            <button class="button primary" id="save-deck" ${editingDeck.cards.length !== catalog.deckRules.size ? "disabled" : ""}>Save Deck</button>
            <button class="button danger" id="delete-deck">Delete</button>
          </div>
        </div>
      </div>
    </section>`;

  document.querySelector("#back-main-menu").onclick = () => {
    editingDeck = null;
    renderHome();
  };

  document.querySelectorAll(".deck-choice").forEach((button) => {
    button.onclick = () => {
      const deck = decks.find((item) => item.id === button.dataset.deckId);
      editingDeck = cloneDeck(deck);
      renderDeckBuilder();
    };
  });

  document.querySelector("#new-deck").onclick = () => {
    editingDeck = { id: crypto.randomUUID(), name: "New Deck", cards: [] };
    renderDeckBuilder();
  };

  document.querySelector("#deck-name").oninput = (event) => {
    editingDeck.name = event.target.value;
  };

  document.querySelectorAll(".add-card").forEach((button) => {
    button.onclick = () => {
      editingDeck.cards.push(button.dataset.cardId);
      renderDeckBuilder();
    };
  });

  document.querySelectorAll(".remove-card").forEach((button) => {
    button.onclick = () => {
      const index = editingDeck.cards.lastIndexOf(button.dataset.cardId);
      if (index >= 0) editingDeck.cards.splice(index, 1);
      renderDeckBuilder();
    };
  });

  document.querySelector("#save-deck").onclick = () => {
    editingDeck.name = editingDeck.name.trim() || "Deck";
    const index = decks.findIndex((item) => item.id === editingDeck.id);
    if (index >= 0) decks[index] = cloneDeck(editingDeck);
    else decks.push(cloneDeck(editingDeck));
    saveDecks();
    showToast("Deck saved.");
    renderDeckBuilder();
  };

  document.querySelector("#delete-deck").onclick = () => {
    decks = decks.filter((item) => item.id !== editingDeck.id);
    if (decks.length === 0) ensureStarterDeck();
    editingDeck = cloneDeck(decks[0]);
    saveDecks();
    renderDeckBuilder();
  };
}

function renderGame() {
  document.body.classList.add("game-active");

  const you = room.you;
  const enemy = room.opponent;
  const yourTurn = room.phase === "playing" && room.turnPlayerId === you.id;
  const winnerText = room.phase === "finished" ? (room.winnerId === you.id ? "Victory" : "Defeat") : "";

  const center = room.phase === "finished"
    ? `<div class="game-over"><h2>${winnerText}</h2><button class="button primary" id="leave-game">Return to Menu</button></div>`
    : `<strong>${yourTurn ? "Your turn" : "Opponent's turn"}</strong><div class="muted">Turn ${room.turn}</div><button class="button" id="end-turn" ${yourTurn ? "" : "disabled"}>End Turn</button>`;

  app.innerHTML = `
    <section class="panel battlefield">
      <div>
        <div class="hero-row">${heroHtml(enemy, false)}</div>
        <div class="opponent-hand">${opponentHandHtml(enemy)}</div>
      </div>
      <div class="turn-center card-drop-zone">${center}</div>
      <div>
        <div class="hand">${you.hand.map((cardId, index) => cardHtml(cardId, index, yourTurn, you.mana)).join("")}</div>
      </div>
      <div class="player-hud" aria-label="Your health and mana">
        <div class="hud-stat hud-health">
          <span class="hud-art" aria-hidden="true"></span>
          <div>
            <span class="hud-label">Health</span>
            <strong>${you.health}</strong>
          </div>
        </div>
        <div class="hud-stat hud-mana">
          <span class="hud-art" aria-hidden="true"></span>
          <div>
            <span class="hud-label">Mana</span>
            <strong>${you.mana}/${you.maxMana}</strong>
          </div>
        </div>
      </div>
      <div class="item-bar" aria-label="Your items">
        ${you.items.map((itemId, index) => itemHtml(itemId, index, yourTurn)).join("")}
      </div>
    </section>`;

  if (room.phase === "finished") {
    document.querySelector("#leave-game").onclick = () => {
      leaveSession();
      renderHome();
    };
    return;
  }

  document.querySelector("#end-turn").onclick = () => send({ type: "end_turn" });

  const dropZone = document.querySelector(".card-drop-zone");
  let draggedCard = null;

  document.querySelectorAll(".card[data-card-index]").forEach((button) => {
    button.addEventListener("dragstart", (event) => {
      if (button.disabled) {
        event.preventDefault();
        return;
      }

      draggedCard = button;
      button.classList.add("card-dragging");
      dropZone.classList.add("card-drop-active");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", button.dataset.cardIndex);
    });

    button.addEventListener("dragend", () => {
      button.classList.remove("card-dragging");
      dropZone.classList.remove("card-drop-active", "card-drop-hover");
      draggedCard = null;
    });
  });

  dropZone.addEventListener("dragover", (event) => {
    if (!draggedCard) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    dropZone.classList.add("card-drop-hover");
  });

  dropZone.addEventListener("dragleave", (event) => {
    if (!dropZone.contains(event.relatedTarget)) {
      dropZone.classList.remove("card-drop-hover");
    }
  });

  dropZone.addEventListener("drop", (event) => {
    if (!draggedCard) return;
    event.preventDefault();

    const card = draggedCard;
    card.classList.remove("card-dragging");
    dropZone.classList.remove("card-drop-active", "card-drop-hover");
    draggedCard = null;
    playCard(card);
  });

  document.querySelectorAll(".item-button[data-item-index]").forEach((button) => {
    button.onclick = () => send({ type: "use_item", itemIndex: Number(button.dataset.itemIndex) });
  });
}

function playCard(button) {
  const cardIndex = Number(button.dataset.cardIndex);
  const rect = button.getBoundingClientRect();
  const ghost = button.cloneNode(true);

  ghost.classList.add("card-play-ghost");
  ghost.removeAttribute("data-card-index");
  ghost.disabled = true;
  ghost.style.left = rect.left + "px";
  ghost.style.top = rect.top + "px";
  ghost.style.width = rect.width + "px";
  ghost.style.height = rect.height + "px";
  ghost.style.setProperty("--play-x", (window.innerWidth / 2 - rect.left - rect.width / 2) + "px");
  ghost.style.setProperty("--play-y", (window.innerHeight / 2 - rect.top - rect.height / 2) + "px");

  document.body.appendChild(ghost);
  requestAnimationFrame(() => ghost.classList.add("card-play-ghost-active"));
  ghost.addEventListener("transitionend", () => ghost.remove(), { once: true });

  send({ type: "play_card", cardIndex });
}

function heroHtml(player, isYou) {
  if (!player) return '<div class="hero"><div class="muted">Waiting for opponent…</div></div>';
  const handText = isYou ? "" : '<span class="stat">Hand ' + player.handCount + '</span>';
  const combatStats = isYou
    ? `<span class="stat">Armor ${player.armor}</span><span class="stat">Deck ${player.deckCount}</span>`
    : `<span class="stat">HP ${player.health}</span><span class="stat">Armor ${player.armor}</span><span class="stat">Mana ${player.mana}/${player.maxMana}</span><span class="stat">Deck ${player.deckCount}</span>`;

  return `
    <div class="hero">
      <div class="hero-portrait"></div>
      <div>
        <div class="hero-name">${isYou ? "You" : "Opponent"} · ${escapeHtml(catalog.character.name)}</div>
        <div class="hero-stats">
          ${combatStats}
          ${handText}
        </div>
      </div>
    </div>`;
}

function itemHtml(itemId, index, yourTurn) {
  const item = catalog.items.find((entry) => entry.id === itemId);
  if (!item) return "";

  return `
    <button class="item-button" data-item-index="${index}" ${yourTurn ? "" : "disabled"}>
      <strong>${escapeHtml(item.name)}</strong>
      <span>${escapeHtml(item.text)}</span>
    </button>`;
}

function opponentHandHtml(player) {
  if (!player || !player.handCount) return "";

  return Array.from({ length: player.handCount }, (_, index) =>
    `<div class="card-back" aria-label="Hidden opponent card ${index + 1}"></div>`
  ).join("");
}

function cardHtml(cardId, index, yourTurn, mana) {
  const card = catalog.cards.find((item) => item.id === cardId);
  if (!card) return "";
  const disabled = !yourTurn || card.cost > mana;
  return `
    <button class="card" data-card-index="${index}" ${disabled ? "disabled" : 'draggable="true"'}>
      <div class="card-art" style="background-image:url('${card.art}')"></div>
      <div class="card-name">${escapeHtml(card.name)}</div>
      <div class="card-text">${escapeHtml(card.text)}</div>
      <div class="card-cost">${card.cost} mana</div>
    </button>`;
}

function countCards(cards) {
  const counts = new Map();
  for (const cardId of cards) counts.set(cardId, (counts.get(cardId) || 0) + 1);
  return counts;
}

function cloneDeck(deck) {
  return { id: deck.id, name: deck.name, cards: [...deck.cards] };
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2800);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
