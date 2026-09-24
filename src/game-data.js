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
  }
]);

export const CARD_MAP = new Map(CARDS.map((card) => [card.id, card]));

export const PUBLIC_CATALOG = Object.freeze({
  character: CHARACTER,
  cards: CARDS.map(({ effect, ...card }) => card),
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
