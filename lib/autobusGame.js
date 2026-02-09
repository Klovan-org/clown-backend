// Klovn Autobus - Game Logic

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
const SUITS = ['♠️', '♥️', '♦️', '♣️']

// Pyramid layout: row 1 (top) = 1 card, row 5 (bottom) = 5 cards
// Cards dealt bottom-up: indices 0-4 = row 5, 5-8 = row 4, 9-11 = row 3, 12-13 = row 2, 14 = row 1
const PYRAMID_ROWS = [
  { row: 5, count: 5, startIndex: 0 },   // bottom - 1 drink
  { row: 4, count: 4, startIndex: 5 },   // 2 drinks
  { row: 3, count: 3, startIndex: 9 },   // 3 drinks
  { row: 2, count: 2, startIndex: 12 },  // 4 drinks
  { row: 1, count: 1, startIndex: 14 },  // 5 drinks (top)
]

export function getCardValue(rank) {
  const map = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 }
  return map[rank] || 0
}

export function createDeck() {
  const deck = []
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push({ rank, suit })
    }
  }
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

export function dealGame(playerIds) {
  const deck = createDeck()
  const hands = {}
  const cardsPerPlayer = 5

  // Deal 5 cards to each player
  for (const pid of playerIds) {
    hands[pid] = deck.splice(0, cardsPerPlayer)
  }

  // 15 cards for pyramid
  const pyramidCards = deck.splice(0, 15).map((card, index) => ({
    ...card,
    flipped: false,
    index,
  }))

  // Remaining cards are the draw deck (for bus phase)
  return { hands, pyramidCards, deck }
}

export function getRowForIndex(cardIndex) {
  for (const row of PYRAMID_ROWS) {
    if (cardIndex >= row.startIndex && cardIndex < row.startIndex + row.count) {
      return row.row
    }
  }
  return 5
}

export function getDrinkValue(row) {
  // Row 1 (top) = 5 drinks, Row 5 (bottom) = 1 drink
  return 6 - row
}

export function getDrinkValueForIndex(cardIndex) {
  return getDrinkValue(getRowForIndex(cardIndex))
}

export function canMatch(handCard, flippedCard) {
  return handCard.rank === flippedCard.rank
}

export function checkBusGuess(currentCard, newCard, guess) {
  const currentVal = getCardValue(currentCard.rank)
  const newVal = getCardValue(newCard.rank)

  if (currentVal === newVal) return 'same'
  if (guess === 'higher' && newVal > currentVal) return 'correct'
  if (guess === 'lower' && newVal < currentVal) return 'correct'
  return 'wrong'
}

export function determineBusPlayers(players) {
  // players is array of { user_id, hand } where hand is array of cards
  let maxCards = 0
  for (const p of players) {
    const count = (p.hand || []).length
    if (count > maxCards) maxCards = count
  }
  if (maxCards === 0) return []
  return players.filter(p => (p.hand || []).length === maxCards)
}

export function getPyramidLayout(pyramidCards) {
  // Returns pyramid cards with row/position/value metadata
  return pyramidCards.map((card, index) => {
    const row = getRowForIndex(index)
    const rowInfo = PYRAMID_ROWS.find(r => r.row === row)
    const position = index - rowInfo.startIndex
    return {
      ...card,
      row,
      position,
      drinkValue: getDrinkValue(row),
    }
  })
}

export function formatCard(card) {
  return `${card.rank}${card.suit}`
}
