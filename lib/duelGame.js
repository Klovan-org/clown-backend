// Kafanski Duel - Game Logic

export const ACTIONS = {
  // PICE
  pivo:          { label: 'Pivo',          emoji: '🍺', cost: 50,  alco: +10, respect: +5,   stomak: 0,    skip: 0, category: 'pice' },
  rakija:        { label: 'Rakija',        emoji: '🥃', cost: 80,  alco: +25, respect: +15,  stomak: -10,  skip: 0, category: 'pice' },
  vinjak:        { label: 'Vinjak',        emoji: '🍷', cost: 100, alco: +20, respect: +10,  stomak: +5,   skip: 0, category: 'pice' },
  mineralna:     { label: 'Mineralna',     emoji: '💧', cost: 30,  alco: -15, respect: -20,  stomak: 0,    skip: 0, category: 'pice' },
  // HRANA
  cevapi:        { label: 'Cevapi',        emoji: '🥩', cost: 200, alco: -10, respect: 0,    stomak: +30,  skip: 0, category: 'hrana' },
  kajmak_luk:    { label: 'Kajmak i luk',  emoji: '🧅', cost: 100, alco: -5,  respect: 0,    stomak: +20,  skip: 0, category: 'hrana' },
  kikiriki:      { label: 'Kikiriki',      emoji: '🥜', cost: 50,  alco: 0,   respect: 0,    stomak: +10,  skip: 0, category: 'hrana' },
  ajvar_ljuti:   { label: 'Ljuti ajvar',   emoji: '🌶️', cost: 0,   alco: 0,   respect: +10,  stomak: +5,   skip: 0, category: 'hrana' },
  // SPECIJAL
  pevaj:         { label: 'Pevaj pesmu',   emoji: '🎤', cost: 0,   alco: 0,   respect: 0,    stomak: 0,    skip: 0, category: 'specijal', gamble: true },
  kafetin:       { label: 'Kafetin',       emoji: '💊', cost: 150, alco: -30, respect: 0,    stomak: 0,    skip: 0, category: 'specijal' },
  povracaj:      { label: 'Povracaj',      emoji: '🤮', cost: 0,   alco: -80, respect: -50,  stomak: 0,    skip: 0, category: 'specijal', setsAlco: 20 },
}

export const FLAVOR_TEXTS = {
  pivo: [
    "Konobar: 'Samo jos jedno!'",
    "Hladno pivo nikad ne skodi...",
    "Sta ces, mora se!",
    "E, daj jos jedno!",
  ],
  rakija: [
    "Rakija lije, ekipa navija!",
    "Jedan za zivce!",
    "Konobar: 'E to be brate!'",
    "Domaca sljivovica, nema greske!",
  ],
  vinjak: [
    "Vinjak za pravo drustvo!",
    "Konobar: 'Za gospodina vinjak!'",
    "Klasa se prepoznaje...",
  ],
  mineralna: [
    "Ekipa: 'Sta si picka...'",
    "Konobar pogledom sudi.",
    "Mineralna u kafani? Stvarno?",
    "Sramota za celu kafanu.",
  ],
  cevapi: [
    "Deset u lepinji sa svim!",
    "Spas za stomak!",
    "Cevapi resavaju sve probleme.",
  ],
  kajmak_luk: [
    "Kajmak i luk, klasika!",
    "Jedes kao da nema sutra.",
    "Kajmak se topi, mmm...",
  ],
  kikiriki: [
    "Grize kikiriki, gleda u daljinu...",
    "Bar nesto u stomak.",
    "Kikiriki gang!",
  ],
  ajvar_ljuti: [
    "LJUTI! Celo lice crveno!",
    "Ekipa navija: 'Ajde, ajde!'",
    "Ajvar przi, ali daje respect!",
  ],
  pevaj: [
    "Uzima mikrofon... publika drzi dah!",
    "Staje na sto i krece da peva!",
    "Konobar: 'Samo nemoj onu...'",
  ],
  kafetin: [
    "Brza pomoc za glavu!",
    "Konobar: 'Opet kafetin?'",
    "Farmaceutska pomoc stigla!",
  ],
  povracaj: [
    "Istrci napolje... zvuci se cuju do ulice.",
    "Konobar: 'Ne na pod!!!'",
    "Reset sistema, ali po cenu reputacije.",
  ],
}

const INITIAL_STATS = {
  alcometer: 0,
  respect: 50,
  stomak: 50,
  novcanik: 500,
  turn_number: 0,
  pijani_foulovi: 0,
}

const MAX_TURNS = 10

export function getInitialStats() {
  return { ...INITIAL_STATS }
}

export function getMaxTurns() {
  return MAX_TURNS
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val))
}

export function applyAction(state, actionKey) {
  const action = ACTIONS[actionKey]
  if (!action) return { error: 'Nepoznata akcija' }

  if (action.cost > state.novcanik) {
    return { error: 'Nemas dovoljno dinara!' }
  }

  const newState = { ...state }
  newState.novcanik -= action.cost
  newState.turn_number += 1

  // Gamble: pevaj pesmu
  if (action.gamble) {
    const isGood = newState.alcometer >= 40 && newState.alcometer <= 70
    if (isGood) {
      newState.respect = clamp(newState.respect + 30, 0, 100)
    } else {
      newState.respect = clamp(newState.respect - 40, 0, 100)
    }
  } else if (action.setsAlco !== undefined) {
    // Povracaj: set alcometer to fixed value
    newState.alcometer = action.setsAlco
    newState.respect = clamp(newState.respect + action.respect, 0, 100)
  } else {
    newState.alcometer = clamp(newState.alcometer + action.alco, 0, 100)
    newState.respect = clamp(newState.respect + action.respect, 0, 100)
    newState.stomak = clamp(newState.stomak + action.stomak, 0, 100)
  }

  // Pijani foul check
  if (newState.alcometer > 80) {
    newState.pijani_foulovi += 1
  }

  // Pick flavor text
  const flavors = FLAVOR_TEXTS[actionKey] || []
  const flavorText = flavors[Math.floor(Math.random() * flavors.length)] || ''

  return { newState, flavorText }
}

export function checkInstantLoss(state) {
  if (state.alcometer > 95) return 'Pao pod sto! Alcometer preko 95!'
  if (state.respect < 10) return 'Ekipa te izbacila! Respect ispod 10!'
  if (state.novcanik < 0) return 'Bankrot! Nemas vise dinara!'
  return null
}

export function calculateScore(state) {
  return (state.respect * 2) + (100 - state.alcometer) - (state.pijani_foulovi * 10)
}

export function getAvailableActions(state) {
  const available = {}
  for (const [key, action] of Object.entries(ACTIONS)) {
    available[key] = {
      ...action,
      affordable: action.cost <= state.novcanik,
    }
  }
  return available
}
