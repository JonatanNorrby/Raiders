export const DECK_RULES = Object.freeze({
  size: 8,
  maxCopies: 4,
  startingHand: 3,
  maxMana: 10
});

export const CHARACTER = Object.freeze({
  id: "raider",
  name: "Raider",
  maxHealth: 20,
  art: "/assets/characters/raider/portrait.png"
});

export const CARDS = Object.freeze([
  {
    id: "quick-strike",
    name: "Quick Strike",
    cost: 1,
    text: "Deal 2 damage to the enemy Raider.",
    art: "/assets/cards/art/quick-strike.png",
    effect: { type: "damage", value: 2 }
  },
  {
    id: "iron-guard",
    name: "Iron Guard",
    cost: 1,
    text: "Gain 3 armor.",
    art: "/assets/cards/art/iron-guard.png",
    effect: { type: "armor", value: 3 }
  },
  {
    id: "firebomb",
    name: "Firebomb",
    cost: 2,
    text: "Deal 4 damage to the enemy Raider.",
    art: "/assets/cards/art/firebomb.png",
    effect: { type: "damage", value: 4 }
  },
  {
    id: "shieldguard",
    name: "Shieldguard",
    cost: 2,
    text: "Summon a 1/4 minion with Taunt.",
    art: "/assets/cards/art/shieldguard.png",
    effect: {
      type: "summon",
      minion: { attack: 1, health: 4, taunt: true }
    }
  },
  {
    id: "footman",
    name: "Footman",
    cost: 2,
    text: "Summon a 3/2 minion.",
    art: "/assets/cards/art/footman.png",
    effect: {
      type: "summon",
      minion: { attack: 3, health: 2 }
    }
  },
  {
    id: "field-medic",
    name: "Field Medic",
    cost: 3,
    text: "Summon a 1/3 minion. At the end of your turn, heal your other minions for 1.",
    art: "/assets/cards/art/field-medic.png",
    effect: {
      type: "summon",
      minion: { attack: 1, health: 3, endTurnHeal: 1 }
    }
  }
]);

export const ITEMS = Object.freeze([
  {
    id: "health-potion",
    name: "Health Potion",
    text: "Restore 5 health.",
    effect: { type: "heal", value: 5 }
  },
  {
    id: "mana-potion",
    name: "Mana Potion",
    text: "Gain 2 mana this turn, even above your maximum.",
    effect: { type: "mana", value: 2 }
  },
  {
    id: "dagger",
    name: "Dagger",
    text: "Deal 3 damage to the enemy.",
    effect: { type: "damage", value: 3 }
  },
  {
    id: "iron-charm",
    name: "Iron Charm",
    text: "Gain 4 armor.",
    effect: { type: "armor", value: 4 }
  }
]);

export const CARD_MAP = new Map(CARDS.map((card) => [card.id, card]));
export const ITEM_MAP = new Map(ITEMS.map((item) => [item.id, item]));

export const PUBLIC_CATALOG = Object.freeze({
  character: CHARACTER,
  cards: CARDS.map(({ effect, ...card }) => card),
  items: ITEMS.map(({ effect, ...item }) => item),
  deckRules: DECK_RULES
});

export function validateDeck(deck) {
  if (!deck || !Array.isArray(deck.cards)) {
    return { ok: false, message: "Invalid deck." };
  }

  if (deck.cards.length !== DECK_RULES.size) {
    return { ok: false, message: "Deck must contain exactly " + DECK_RULES.size + " cards." };
  }

  const counts = new Map();

  for (const cardId of deck.cards) {
    if (!CARD_MAP.has(cardId)) {
      return { ok: false, message: "Deck contains an unknown card." };
    }

    const count = (counts.get(cardId) || 0) + 1;
    if (count > DECK_RULES.maxCopies) {
      return { ok: false, message: "Too many copies of " + CARD_MAP.get(cardId).name + "." };
    }
    counts.set(cardId, count);
  }

  return { ok: true };
}
