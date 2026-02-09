import { pool } from "../lib/db.js";
import { verifyTelegramWebAppData } from "../lib/telegram.js";
import {
  dealGame,
  canMatch,
  getDrinkValueForIndex,
  getRowForIndex,
  getDrinkValue,
  checkBusGuess,
  determineBusPlayers,
  getPyramidLayout,
  formatCard,
} from "../lib/autobusGame.js";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-telegram-init-data");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

function auth(req) {
  const initData = req.headers["x-telegram-init-data"];
  if (!initData) throw new Error("Missing auth header");
  return verifyTelegramWebAppData(initData);
}

export default async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const op = req.query.op;

  try {
    if (req.method === "GET") {
      if (op === "state") return handleGetState(req, res);
      if (op === "lobby") return handleLobby(req, res);
      if (op === "init") return handleInit(req, res);
      return res.status(400).json({ error: "Unknown op" });
    }

    if (req.method === "POST") {
      if (op === "create") return handleCreate(req, res);
      if (op === "join") return handleJoin(req, res);
      if (op === "start") return handleStart(req, res);
      if (op === "flip") return handleFlip(req, res);
      if (op === "match") return handleMatch(req, res);
      if (op === "pass") return handlePass(req, res);
      if (op === "bus_guess") return handleBusGuess(req, res);
      if (op === "init") return handleInit(req, res);
      return res.status(400).json({ error: "Unknown op" });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    console.error("autobus error:", err);
    if (err.message === "Missing auth header" || err.message === "Invalid init data" || err.message === "No init data") {
      return res.status(401).json({ error: err.message });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ===================== CREATE =====================
async function handleCreate(req, res) {
  const userId = auth(req);

  // Check user exists
  const userCheck = await pool.query("SELECT telegram_id, username, first_name FROM users WHERE telegram_id = $1", [userId]);
  if (userCheck.rowCount === 0) return res.status(404).json({ error: "Korisnik nije pronadjen" });

  const user = userCheck.rows[0];

  const gameRes = await pool.query(
    `INSERT INTO autobus_games (status, current_phase, created_by)
     VALUES ('lobby', 'lobby', $1)
     RETURNING id`,
    [userId]
  );
  const gameId = gameRes.rows[0].id;

  await pool.query(
    `INSERT INTO autobus_players (game_id, user_id, username, first_name, turn_order)
     VALUES ($1, $2, $3, $4, 0)`,
    [gameId, userId, user.username, user.first_name]
  );

  res.json({ ok: true, game_id: gameId });
}

// ===================== JOIN =====================
async function handleJoin(req, res) {
  const userId = auth(req);
  const gameId = req.query.id;
  if (!gameId) return res.status(400).json({ error: "Missing game id" });

  const game = await pool.query("SELECT * FROM autobus_games WHERE id = $1 AND status = 'lobby'", [gameId]);
  if (game.rowCount === 0) return res.status(404).json({ error: "Igra nije pronadjena ili vec pocela" });

  const existing = await pool.query("SELECT 1 FROM autobus_players WHERE game_id = $1 AND user_id = $2", [gameId, userId]);
  if (existing.rowCount > 0) return res.status(400).json({ error: "Vec si u igri" });

  const playerCount = await pool.query("SELECT COUNT(*) FROM autobus_players WHERE game_id = $1", [gameId]);
  if (parseInt(playerCount.rows[0].count) >= 8) return res.status(400).json({ error: "Igra je puna (max 8 igraca)" });

  const userCheck = await pool.query("SELECT telegram_id, username, first_name FROM users WHERE telegram_id = $1", [userId]);
  if (userCheck.rowCount === 0) return res.status(404).json({ error: "Korisnik nije pronadjen" });
  const user = userCheck.rows[0];

  const turnOrder = parseInt(playerCount.rows[0].count);

  await pool.query(
    `INSERT INTO autobus_players (game_id, user_id, username, first_name, turn_order)
     VALUES ($1, $2, $3, $4, $5)`,
    [gameId, userId, user.username, user.first_name, turnOrder]
  );

  res.json({ ok: true });
}

// ===================== START =====================
async function handleStart(req, res) {
  const userId = auth(req);
  const gameId = req.query.id;
  if (!gameId) return res.status(400).json({ error: "Missing game id" });

  const game = await pool.query("SELECT * FROM autobus_games WHERE id = $1 AND status = 'lobby'", [gameId]);
  if (game.rowCount === 0) return res.status(404).json({ error: "Igra nije pronadjena ili vec pocela" });

  if (String(game.rows[0].created_by) !== String(userId)) {
    return res.status(403).json({ error: "Samo kreator moze da pokrene igru" });
  }

  const playersRes = await pool.query("SELECT user_id FROM autobus_players WHERE game_id = $1 ORDER BY turn_order", [gameId]);
  if (playersRes.rowCount < 1) return res.status(400).json({ error: "Potrebno je bar 1 igrac" });

  const playerIds = playersRes.rows.map(r => r.user_id);
  const { hands, pyramidCards, deck } = dealGame(playerIds);

  // Update each player's hand
  for (const pid of playerIds) {
    await pool.query(
      "UPDATE autobus_players SET hand = $1 WHERE game_id = $2 AND user_id = $3",
      [JSON.stringify(hands[pid]), gameId, pid]
    );
  }

  // Update game state
  await pool.query(
    `UPDATE autobus_games
     SET status = 'active', current_phase = 'pyramid', current_card_index = -1,
         match_turn_index = 0, matching_done = FALSE,
         pyramid_cards = $1, deck = $2
     WHERE id = $3`,
    [JSON.stringify(pyramidCards), JSON.stringify(deck), gameId]
  );

  res.json({ ok: true });
}

// ===================== GET STATE =====================
async function handleGetState(req, res) {
  const userId = auth(req);
  const gameId = req.query.id;
  if (!gameId) return res.status(400).json({ error: "Missing game id" });

  const game = await pool.query("SELECT * FROM autobus_games WHERE id = $1", [gameId]);
  if (game.rowCount === 0) return res.status(404).json({ error: "Igra nije pronadjena" });

  const g = game.rows[0];

  const playersRes = await pool.query(
    "SELECT * FROM autobus_players WHERE game_id = $1 ORDER BY turn_order",
    [gameId]
  );

  const amInGame = playersRes.rows.some(p => String(p.user_id) === String(userId));
  if (!amInGame && g.status !== 'lobby') {
    return res.status(403).json({ error: "Nisi ucesnik ove igre" });
  }

  const logRes = await pool.query(
    "SELECT * FROM autobus_actions_log WHERE game_id = $1 ORDER BY created_at DESC LIMIT 20",
    [gameId]
  );

  // Build pyramid view (hide unflipped cards for clients)
  const pyramidCards = g.pyramid_cards || [];
  const pyramidView = pyramidCards.map((card, index) => {
    const row = getRowForIndex(index);
    return {
      index,
      row,
      drinkValue: getDrinkValue(row),
      flipped: card.flipped,
      rank: card.flipped ? card.rank : null,
      suit: card.flipped ? card.suit : null,
    };
  });

  // My hand
  const myPlayer = playersRes.rows.find(p => String(p.user_id) === String(userId));
  const myHand = myPlayer ? (myPlayer.hand || []) : [];

  // Current flipped card
  let currentFlippedCard = null;
  if (g.current_phase === 'pyramid' && g.current_card_index >= 0 && g.current_card_index < pyramidCards.length) {
    const card = pyramidCards[g.current_card_index];
    if (card.flipped) {
      currentFlippedCard = {
        rank: card.rank,
        suit: card.suit,
        index: g.current_card_index,
        drinkValue: getDrinkValueForIndex(g.current_card_index),
      };
    }
  }

  // Can I match?
  let canMatchCurrent = false;
  let matchableCards = [];
  if (currentFlippedCard && g.current_phase === 'pyramid' && !g.matching_done && myPlayer) {
    const myTurnOrder = myPlayer.turn_order;
    const isMyMatchTurn = myTurnOrder === g.match_turn_index;
    if (isMyMatchTurn && !myPlayer.passed_current) {
      for (const card of myHand) {
        if (canMatch(card, currentFlippedCard)) {
          matchableCards.push(card);
          canMatchCurrent = true;
        }
      }
    }
  }

  // Is it my turn to act (match or pass)?
  const isMyMatchTurn = g.current_phase === 'pyramid' &&
    !g.matching_done &&
    myPlayer &&
    myPlayer.turn_order === g.match_turn_index &&
    g.current_card_index >= 0;

  // Can anyone flip?
  const needsFlip = g.current_phase === 'pyramid' &&
    (g.current_card_index === -1 || g.matching_done) &&
    g.current_card_index < 14;

  // Bus phase info
  const isBusPlayer = g.current_phase === 'bus' && String(g.bus_player_id) === String(userId);

  // Players view (hide other players' hands)
  const playersView = playersRes.rows.map(p => ({
    user_id: p.user_id,
    username: p.username,
    first_name: p.first_name,
    hand_count: (p.hand || []).length,
    drinks_received: p.drinks_received,
    turn_order: p.turn_order,
    is_match_turn: p.turn_order === g.match_turn_index && g.current_phase === 'pyramid' && !g.matching_done,
    passed_current: p.passed_current,
  }));

  res.json({
    game: {
      id: g.id,
      status: g.status,
      current_phase: g.current_phase,
      current_card_index: g.current_card_index,
      match_turn_index: g.match_turn_index,
      matching_done: g.matching_done,
      bus_player_id: g.bus_player_id,
      bus_progress: g.bus_progress,
      bus_current_card: g.bus_current_card,
      bus_player_queue: g.bus_player_queue,
      bus_queue_index: g.bus_queue_index,
      created_by: g.created_by,
      created_at: g.created_at,
      finished_at: g.finished_at,
    },
    players: playersView,
    pyramid: pyramidView,
    my_hand: myHand,
    my_id: userId,
    current_flipped_card: currentFlippedCard,
    can_match: canMatchCurrent,
    matchable_cards: matchableCards,
    is_my_match_turn: isMyMatchTurn,
    needs_flip: needsFlip,
    is_bus_player: isBusPlayer,
    recent_log: logRes.rows,
  });
}

// ===================== FLIP =====================
async function handleFlip(req, res) {
  const userId = auth(req);
  const gameId = req.query.id;
  if (!gameId) return res.status(400).json({ error: "Missing game id" });

  const game = await pool.query("SELECT * FROM autobus_games WHERE id = $1 AND status = 'active'", [gameId]);
  if (game.rowCount === 0) return res.status(404).json({ error: "Igra nije aktivna" });

  const g = game.rows[0];
  if (g.current_phase !== 'pyramid') return res.status(400).json({ error: "Nije piramida faza" });

  // Can only flip if matching is done (or first flip)
  if (g.current_card_index >= 0 && !g.matching_done) {
    return res.status(400).json({ error: "Matching jos nije zavrsen za trenutnu kartu" });
  }

  const nextIndex = g.current_card_index + 1;
  if (nextIndex >= 15) {
    return res.status(400).json({ error: "Sve karte su vec okrenute" });
  }

  const pyramidCards = g.pyramid_cards || [];
  pyramidCards[nextIndex].flipped = true;

  // Reset all players' passed_current
  await pool.query("UPDATE autobus_players SET passed_current = FALSE WHERE game_id = $1", [gameId]);

  await pool.query(
    `UPDATE autobus_games
     SET current_card_index = $1, pyramid_cards = $2, match_turn_index = 0, matching_done = FALSE
     WHERE id = $3`,
    [nextIndex, JSON.stringify(pyramidCards), gameId]
  );

  const flippedCard = pyramidCards[nextIndex];

  await pool.query(
    `INSERT INTO autobus_actions_log (game_id, user_id, action_type, card_data, flavor_text)
     VALUES ($1, $2, 'flip_card', $3, $4)`,
    [gameId, userId, JSON.stringify(flippedCard), `Okrenuta karta: ${formatCard(flippedCard)} (${getDrinkValueForIndex(nextIndex)} cugova)`]
  );

  res.json({ ok: true, card: flippedCard, drink_value: getDrinkValueForIndex(nextIndex) });
}

// ===================== MATCH =====================
async function handleMatch(req, res) {
  const userId = auth(req);
  const gameId = req.query.id;
  if (!gameId) return res.status(400).json({ error: "Missing game id" });

  const { card, target_user_id } = req.body || {};
  if (!card || !target_user_id) return res.status(400).json({ error: "Missing card or target_user_id" });
  // Self-drink allowed (solo mode)

  const game = await pool.query("SELECT * FROM autobus_games WHERE id = $1 AND status = 'active'", [gameId]);
  if (game.rowCount === 0) return res.status(404).json({ error: "Igra nije aktivna" });

  const g = game.rows[0];
  if (g.current_phase !== 'pyramid') return res.status(400).json({ error: "Nije piramida faza" });
  if (g.matching_done) return res.status(400).json({ error: "Matching je zavrsen za ovu kartu" });
  if (g.current_card_index < 0) return res.status(400).json({ error: "Nijedna karta nije okrenuta" });

  // Check it's this player's match turn
  const playerRes = await pool.query(
    "SELECT * FROM autobus_players WHERE game_id = $1 AND user_id = $2",
    [gameId, userId]
  );
  if (playerRes.rowCount === 0) return res.status(403).json({ error: "Nisi u igri" });
  const player = playerRes.rows[0];

  if (player.turn_order !== g.match_turn_index) {
    return res.status(400).json({ error: "Nije tvoj red za matching" });
  }

  // Check flipped card
  const pyramidCards = g.pyramid_cards || [];
  const flippedCard = pyramidCards[g.current_card_index];
  if (!flippedCard || !flippedCard.flipped) return res.status(400).json({ error: "Nema okrenute karte" });

  // Check player has the card
  const hand = player.hand || [];
  const cardIdx = hand.findIndex(c => c.rank === card.rank && c.suit === card.suit);
  if (cardIdx === -1) return res.status(400).json({ error: "Nemas tu kartu u ruci" });

  // Check card matches flipped card rank
  if (!canMatch(card, flippedCard)) {
    return res.status(400).json({ error: "Karta se ne poklapa sa otvorenom kartom" });
  }

  // Check target player exists in game
  const targetRes = await pool.query(
    "SELECT * FROM autobus_players WHERE game_id = $1 AND user_id = $2",
    [gameId, target_user_id]
  );
  if (targetRes.rowCount === 0) return res.status(400).json({ error: "Ciljani igrac nije u igri" });

  // Remove card from hand
  hand.splice(cardIdx, 1);
  await pool.query(
    "UPDATE autobus_players SET hand = $1, passed_current = TRUE WHERE game_id = $2 AND user_id = $3",
    [JSON.stringify(hand), gameId, userId]
  );

  // Give drinks to target
  const drinkValue = getDrinkValueForIndex(g.current_card_index);
  await pool.query(
    "UPDATE autobus_players SET drinks_received = drinks_received + $1 WHERE game_id = $2 AND user_id = $3",
    [drinkValue, gameId, target_user_id]
  );

  // Get target player name for log
  const targetPlayer = targetRes.rows[0];
  const targetName = targetPlayer.first_name || targetPlayer.username || 'Klovn';
  const playerName = player.first_name || player.username || 'Klovn';

  // Log action
  await pool.query(
    `INSERT INTO autobus_actions_log (game_id, user_id, action_type, matched_card, target_user_id, drinks_given, flavor_text)
     VALUES ($1, $2, 'match_card', $3, $4, $5, $6)`,
    [gameId, userId, JSON.stringify(card), target_user_id, drinkValue,
     `${playerName} match-ovao ${formatCard(card)} i dao ${drinkValue} cug(ova) igracu ${targetName}!`]
  );

  // Advance match turn to next player
  const totalPlayers = await pool.query("SELECT COUNT(*) FROM autobus_players WHERE game_id = $1", [gameId]);
  const nextMatchTurn = g.match_turn_index + 1;

  if (nextMatchTurn >= parseInt(totalPlayers.rows[0].count)) {
    // All players have had their turn - matching done
    await pool.query("UPDATE autobus_games SET match_turn_index = $1, matching_done = TRUE WHERE id = $2", [nextMatchTurn, gameId]);
    await maybeTransitionToBus(gameId, g);
  } else {
    await pool.query("UPDATE autobus_games SET match_turn_index = $1 WHERE id = $2", [nextMatchTurn, gameId]);
  }

  res.json({ ok: true, drinks_given: drinkValue, cards_left: hand.length });
}

// ===================== PASS =====================
async function handlePass(req, res) {
  const userId = auth(req);
  const gameId = req.query.id;
  if (!gameId) return res.status(400).json({ error: "Missing game id" });

  const game = await pool.query("SELECT * FROM autobus_games WHERE id = $1 AND status = 'active'", [gameId]);
  if (game.rowCount === 0) return res.status(404).json({ error: "Igra nije aktivna" });

  const g = game.rows[0];
  if (g.current_phase !== 'pyramid') return res.status(400).json({ error: "Nije piramida faza" });
  if (g.matching_done) return res.status(400).json({ error: "Matching je zavrsen" });
  if (g.current_card_index < 0) return res.status(400).json({ error: "Nijedna karta nije okrenuta" });

  const playerRes = await pool.query(
    "SELECT * FROM autobus_players WHERE game_id = $1 AND user_id = $2",
    [gameId, userId]
  );
  if (playerRes.rowCount === 0) return res.status(403).json({ error: "Nisi u igri" });
  const player = playerRes.rows[0];

  if (player.turn_order !== g.match_turn_index) {
    return res.status(400).json({ error: "Nije tvoj red" });
  }

  // Mark as passed
  await pool.query(
    "UPDATE autobus_players SET passed_current = TRUE WHERE game_id = $1 AND user_id = $2",
    [gameId, userId]
  );

  // Advance match turn
  const totalPlayers = await pool.query("SELECT COUNT(*) FROM autobus_players WHERE game_id = $1", [gameId]);
  const nextMatchTurn = g.match_turn_index + 1;

  if (nextMatchTurn >= parseInt(totalPlayers.rows[0].count)) {
    await pool.query("UPDATE autobus_games SET match_turn_index = $1, matching_done = TRUE WHERE id = $2", [nextMatchTurn, gameId]);
    await maybeTransitionToBus(gameId, g);
  } else {
    await pool.query("UPDATE autobus_games SET match_turn_index = $1 WHERE id = $2", [nextMatchTurn, gameId]);
  }

  res.json({ ok: true });
}

// ===================== BUS GUESS =====================
async function handleBusGuess(req, res) {
  const userId = auth(req);
  const gameId = req.query.id;
  if (!gameId) return res.status(400).json({ error: "Missing game id" });

  const { guess } = req.body || {};
  if (!guess || !['higher', 'lower'].includes(guess)) {
    return res.status(400).json({ error: "Guess mora biti 'higher' ili 'lower'" });
  }

  const game = await pool.query("SELECT * FROM autobus_games WHERE id = $1 AND status = 'active'", [gameId]);
  if (game.rowCount === 0) return res.status(404).json({ error: "Igra nije aktivna" });

  const g = game.rows[0];
  if (g.current_phase !== 'bus') return res.status(400).json({ error: "Nije autobus faza" });
  if (String(g.bus_player_id) !== String(userId)) return res.status(400).json({ error: "Nisi u autobusu" });
  if (!g.bus_current_card) return res.status(400).json({ error: "Nema trenutne karte" });

  const deck = g.deck || [];
  if (deck.length === 0) {
    // Reshuffle - shouldn't normally happen with 52 cards but safety
    return res.status(400).json({ error: "Nema vise karata u spilu" });
  }

  const newCard = deck.shift();
  const result = checkBusGuess(g.bus_current_card, newCard, guess);

  let newProgress = g.bus_progress;
  let penaltyDrinks = 0;
  let flavorText = '';
  const playerRes = await pool.query("SELECT * FROM autobus_players WHERE game_id = $1 AND user_id = $2", [gameId, userId]);
  const playerName = playerRes.rows[0]?.first_name || playerRes.rows[0]?.username || 'Klovn';

  if (result === 'correct') {
    newProgress += 1;
    flavorText = `${playerName} pogodio! ${formatCard(g.bus_current_card)} → ${formatCard(newCard)} (${guess === 'higher' ? 'Veca' : 'Manja'}) ✅ ${newProgress}/5`;
  } else {
    penaltyDrinks = newProgress > 0 ? newProgress : 1;
    flavorText = result === 'same'
      ? `${playerName}: ${formatCard(g.bus_current_card)} → ${formatCard(newCard)} ISTA KARTA! 💀 Pije ${penaltyDrinks} cug(ova)! Reset!`
      : `${playerName}: ${formatCard(g.bus_current_card)} → ${formatCard(newCard)} PROMASAJ! 💀 Pije ${penaltyDrinks} cug(ova)! Reset!`;
    newProgress = 0;

    // Add penalty drinks
    if (playerRes.rowCount > 0) {
      await pool.query(
        "UPDATE autobus_players SET drinks_received = drinks_received + $1 WHERE game_id = $2 AND user_id = $3",
        [penaltyDrinks, gameId, userId]
      );
    }
  }

  // Log action
  await pool.query(
    `INSERT INTO autobus_actions_log (game_id, user_id, action_type, card_data, bus_guess, bus_result, drinks_given, flavor_text)
     VALUES ($1, $2, 'bus_guess', $3, $4, $5, $6, $7)`,
    [gameId, userId, JSON.stringify(newCard), guess, result, penaltyDrinks, flavorText]
  );

  // Check if bus complete
  if (newProgress >= 5) {
    // Check if there are more bus players in queue
    const busQueue = g.bus_player_queue || [];
    const nextQueueIndex = (g.bus_queue_index || 0) + 1;

    if (nextQueueIndex < busQueue.length) {
      // Next bus player
      const nextBusPlayerId = busQueue[nextQueueIndex];
      const nextCard = deck.shift();
      await pool.query(
        `UPDATE autobus_games
         SET bus_progress = 0, bus_current_card = $1, bus_player_id = $2,
             bus_queue_index = $3, deck = $4
         WHERE id = $5`,
        [JSON.stringify(nextCard), nextBusPlayerId, nextQueueIndex, JSON.stringify(deck), gameId]
      );

      await pool.query(
        `INSERT INTO autobus_actions_log (game_id, user_id, action_type, flavor_text)
         VALUES ($1, $2, 'bus_exit', $3)`,
        [gameId, userId, `${playerName} izasao iz autobusa! 🎉`]
      );

      res.json({
        ok: true, result, new_card: newCard, bus_progress: 0,
        penalty_drinks: penaltyDrinks, game_over: false,
        flavor_text: `${playerName} izasao iz autobusa! Sledeci igrac ulazi...`,
        next_bus_player: nextBusPlayerId,
      });
    } else {
      // Game finished!
      await pool.query(
        "UPDATE autobus_games SET status = 'finished', current_phase = 'finished', bus_progress = $1, deck = $2, bus_current_card = $3, finished_at = NOW() WHERE id = $4",
        [newProgress, JSON.stringify(deck), JSON.stringify(newCard), gameId]
      );

      await pool.query(
        `INSERT INTO autobus_actions_log (game_id, user_id, action_type, flavor_text)
         VALUES ($1, $2, 'game_finished', $3)`,
        [gameId, userId, `${playerName} izasao iz autobusa! Igra zavrsena! 🎉🚌`]
      );

      res.json({
        ok: true, result, new_card: newCard, bus_progress: newProgress,
        penalty_drinks: penaltyDrinks, game_over: true,
        flavor_text: flavorText,
      });
    }
    return;
  }

  // Update game state
  await pool.query(
    "UPDATE autobus_games SET bus_progress = $1, bus_current_card = $2, deck = $3 WHERE id = $4",
    [newProgress, JSON.stringify(newCard), JSON.stringify(deck), gameId]
  );

  res.json({
    ok: true, result, new_card: newCard, bus_progress: newProgress,
    penalty_drinks: penaltyDrinks, game_over: false,
    flavor_text: flavorText,
  });
}

// ===================== LOBBY =====================
async function handleLobby(req, res) {
  const userId = auth(req);

  // Active/lobby games I'm in
  const myGames = await pool.query(
    `SELECT g.*, ap.turn_order AS my_turn_order
     FROM autobus_games g
     JOIN autobus_players ap ON ap.game_id = g.id AND ap.user_id = $1
     WHERE g.status IN ('lobby', 'active')
     ORDER BY g.created_at DESC`,
    [userId]
  );

  // Open lobby games I can join
  const openGames = await pool.query(
    `SELECT g.*, (SELECT COUNT(*) FROM autobus_players WHERE game_id = g.id) AS player_count,
       u.first_name AS creator_name, u.username AS creator_username
     FROM autobus_games g
     LEFT JOIN users u ON u.telegram_id = g.created_by
     WHERE g.status = 'lobby'
       AND g.id NOT IN (SELECT game_id FROM autobus_players WHERE user_id = $1)
     ORDER BY g.created_at DESC
     LIMIT 10`,
    [userId]
  );

  // Recent finished
  const finished = await pool.query(
    `SELECT g.*
     FROM autobus_games g
     JOIN autobus_players ap ON ap.game_id = g.id AND ap.user_id = $1
     WHERE g.status = 'finished'
       AND g.finished_at > NOW() - INTERVAL '24 hours'
     ORDER BY g.finished_at DESC
     LIMIT 5`,
    [userId]
  );

  // For each of my games, get player list
  const gameDetails = [];
  for (const game of myGames.rows) {
    const players = await pool.query(
      "SELECT user_id, username, first_name, turn_order, drinks_received, hand FROM autobus_players WHERE game_id = $1 ORDER BY turn_order",
      [game.id]
    );
    gameDetails.push({
      ...game,
      players: players.rows.map(p => ({
        user_id: p.user_id,
        username: p.username,
        first_name: p.first_name,
        turn_order: p.turn_order,
        drinks_received: p.drinks_received,
        hand_count: (p.hand || []).length,
      })),
    });
  }

  res.json({
    my_id: userId,
    my_games: gameDetails,
    open_games: openGames.rows,
    recent_finished: finished.rows,
  });
}

// ===================== HELPERS =====================
async function maybeTransitionToBus(gameId, game) {
  // Check if all pyramid cards have been flipped AND matching is done
  if (game.current_card_index < 14) return; // Not all cards flipped yet

  // All 15 cards done - transition to bus phase
  const playersRes = await pool.query(
    "SELECT user_id, hand, first_name, username FROM autobus_players WHERE game_id = $1 ORDER BY turn_order",
    [gameId]
  );

  const players = playersRes.rows.map(p => ({
    user_id: p.user_id,
    hand: p.hand || [],
    first_name: p.first_name,
    username: p.username,
  }));

  const busPlayers = determineBusPlayers(players);

  if (busPlayers.length === 0) {
    // Everyone got rid of all cards somehow - game over
    await pool.query(
      "UPDATE autobus_games SET status = 'finished', current_phase = 'finished', finished_at = NOW() WHERE id = $1",
      [gameId]
    );
    return;
  }

  const busPlayerQueue = busPlayers.map(p => p.user_id);
  const firstBusPlayer = busPlayerQueue[0];

  // Draw first card for bus
  const gameRes = await pool.query("SELECT deck FROM autobus_games WHERE id = $1", [gameId]);
  const deck = gameRes.rows[0].deck || [];
  const firstCard = deck.shift();

  const busPlayerName = busPlayers[0].first_name || busPlayers[0].username || 'Klovn';

  await pool.query(
    `UPDATE autobus_games
     SET current_phase = 'bus', bus_player_id = $1, bus_progress = 0,
         bus_current_card = $2, deck = $3, bus_player_queue = $4, bus_queue_index = 0
     WHERE id = $5`,
    [firstBusPlayer, JSON.stringify(firstCard), JSON.stringify(deck), JSON.stringify(busPlayerQueue), gameId]
  );

  const queueNames = busPlayers.map(p => p.first_name || p.username || 'Klovn').join(', ');
  await pool.query(
    `INSERT INTO autobus_actions_log (game_id, user_id, action_type, flavor_text)
     VALUES ($1, $2, 'bus_start', $3)`,
    [gameId, firstBusPlayer,
     busPlayers.length > 1
       ? `Vise igraca ide u autobus: ${queueNames}! Prvo ${busPlayerName}!`
       : `${busPlayerName} ide u autobus! 🚌`]
  );
}

// ===================== INIT (DB SETUP) =====================
async function handleInit(req, res) {
  const secret = req.headers["x-setup-secret"] || req.query.secret;
  if (secret !== process.env.SETUP_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS autobus_games (
        id SERIAL PRIMARY KEY,
        status VARCHAR(20) NOT NULL DEFAULT 'lobby',
        current_phase VARCHAR(20) DEFAULT 'lobby',
        current_card_index INT DEFAULT -1,
        match_turn_index INT DEFAULT 0,
        matching_done BOOLEAN DEFAULT FALSE,
        pyramid_cards JSONB,
        deck JSONB,
        bus_player_id BIGINT,
        bus_progress INT DEFAULT 0,
        bus_current_card JSONB,
        bus_player_queue JSONB,
        bus_queue_index INT DEFAULT 0,
        created_by BIGINT,
        created_at TIMESTAMP DEFAULT NOW(),
        finished_at TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS autobus_players (
        id SERIAL PRIMARY KEY,
        game_id INT NOT NULL REFERENCES autobus_games(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL,
        username VARCHAR(255),
        first_name VARCHAR(255),
        hand JSONB DEFAULT '[]',
        drinks_received INT DEFAULT 0,
        turn_order INT DEFAULT 0,
        is_ready BOOLEAN DEFAULT FALSE,
        passed_current BOOLEAN DEFAULT FALSE,
        UNIQUE(game_id, user_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS autobus_actions_log (
        id SERIAL PRIMARY KEY,
        game_id INT NOT NULL REFERENCES autobus_games(id) ON DELETE CASCADE,
        user_id BIGINT,
        action_type VARCHAR(50) NOT NULL,
        card_data JSONB,
        matched_card JSONB,
        target_user_id BIGINT,
        drinks_given INT DEFAULT 0,
        bus_guess VARCHAR(10),
        bus_result VARCHAR(10),
        flavor_text TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    res.json({ ok: true, message: "Autobus tables created" });
  } catch (err) {
    console.error("autobus init error:", err);
    res.status(500).json({ error: err.message });
  }
}
