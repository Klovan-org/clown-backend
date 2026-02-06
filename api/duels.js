import { pool } from "../lib/db.js";
import { verifyTelegramWebAppData } from "../lib/telegram.js";
import { getInitialStats, applyAction, checkInstantLoss, calculateScore, getAvailableActions, getMaxTurns, ACTIONS } from "../lib/duelGame.js";

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

// GET /api/duels?op=active       - list my active duels
// GET /api/duels?op=state&id=X   - get duel state
// POST /api/duels?op=create      - create duel
// POST /api/duels?op=accept&id=X - accept duel
// POST /api/duels?op=action&id=X - perform action
// POST /api/duels?op=decline&id=X - decline duel

export default async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const op = req.query.op;

  try {
    if (req.method === "GET") {
      if (op === "active") return handleActive(req, res);
      if (op === "state") return handleGetState(req, res);
      return res.status(400).json({ error: "Unknown op" });
    }

    if (req.method === "POST") {
      if (op === "create") return handleCreate(req, res);
      if (op === "accept") return handleAccept(req, res);
      if (op === "decline") return handleDecline(req, res);
      if (op === "action") return handleAction(req, res);
      return res.status(400).json({ error: "Unknown op" });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    console.error("duels error:", err);
    if (err.message === "Missing auth header" || err.message === "Invalid init data" || err.message === "No init data") {
      return res.status(401).json({ error: err.message });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ===================== CREATE =====================
async function handleCreate(req, res) {
  const userId = auth(req);
  const { opponent_id } = req.body || {};

  if (!opponent_id) return res.status(400).json({ error: "Missing opponent_id" });
  if (String(opponent_id) === String(userId)) return res.status(400).json({ error: "Ne mozes da izazoves samog sebe" });

  const oppCheck = await pool.query("SELECT 1 FROM users WHERE telegram_id = $1", [opponent_id]);
  if (oppCheck.rowCount === 0) return res.status(404).json({ error: "Protivnik nije pronadjen" });

  const existing = await pool.query(
    `SELECT id FROM kafanski_duels
     WHERE status IN ('waiting', 'active')
     AND ((player1_id = $1 AND player2_id = $2) OR (player1_id = $2 AND player2_id = $1))`,
    [userId, opponent_id]
  );
  if (existing.rowCount > 0) return res.status(400).json({ error: "Vec imate aktivan duel!" });

  const duelRes = await pool.query(
    `INSERT INTO kafanski_duels (player1_id, player2_id, status, current_turn_user)
     VALUES ($1, $2, 'waiting', $1)
     RETURNING id`,
    [userId, opponent_id]
  );
  const duelId = duelRes.rows[0].id;

  const init = getInitialStats();
  await pool.query(
    `INSERT INTO duel_player_state (duel_id, user_id, alcometer, respect, stomak, novcanik, turn_number, pijani_foulovi)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [duelId, userId, init.alcometer, init.respect, init.stomak, init.novcanik, init.turn_number, init.pijani_foulovi]
  );
  await pool.query(
    `INSERT INTO duel_player_state (duel_id, user_id, alcometer, respect, stomak, novcanik, turn_number, pijani_foulovi)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [duelId, opponent_id, init.alcometer, init.respect, init.stomak, init.novcanik, init.turn_number, init.pijani_foulovi]
  );

  res.json({ ok: true, duel_id: duelId });
}

// ===================== ACCEPT =====================
async function handleAccept(req, res) {
  const userId = auth(req);
  const duelId = req.query.id;
  if (!duelId) return res.status(400).json({ error: "Missing duel id" });

  const duel = await pool.query(
    "SELECT * FROM kafanski_duels WHERE id = $1 AND player2_id = $2 AND status = 'waiting'",
    [duelId, userId]
  );
  if (duel.rowCount === 0) return res.status(404).json({ error: "Duel nije pronadjen ili vec prihvacen" });

  await pool.query(
    "UPDATE kafanski_duels SET status = 'active', current_turn_user = $2 WHERE id = $1",
    [duelId, duel.rows[0].player1_id]
  );

  res.json({ ok: true });
}

// ===================== DECLINE =====================
async function handleDecline(req, res) {
  const userId = auth(req);
  const duelId = req.query.id;
  if (!duelId) return res.status(400).json({ error: "Missing duel id" });

  const duel = await pool.query(
    "SELECT * FROM kafanski_duels WHERE id = $1 AND player2_id = $2 AND status = 'waiting'",
    [duelId, userId]
  );
  if (duel.rowCount === 0) return res.status(404).json({ error: "Duel nije pronadjen" });

  await pool.query("DELETE FROM kafanski_duels WHERE id = $1", [duelId]);
  res.json({ ok: true });
}

// ===================== GET STATE =====================
async function handleGetState(req, res) {
  const userId = auth(req);
  const duelId = req.query.id;
  if (!duelId) return res.status(400).json({ error: "Missing duel id" });

  const duel = await pool.query("SELECT * FROM kafanski_duels WHERE id = $1", [duelId]);
  if (duel.rowCount === 0) return res.status(404).json({ error: "Duel nije pronadjen" });

  const d = duel.rows[0];
  if (String(d.player1_id) !== String(userId) && String(d.player2_id) !== String(userId)) {
    return res.status(403).json({ error: "Nisi ucesnik ovog duela" });
  }

  const states = await pool.query(
    "SELECT * FROM duel_player_state WHERE duel_id = $1 ORDER BY user_id",
    [duelId]
  );

  const log = await pool.query(
    "SELECT * FROM duel_actions_log WHERE duel_id = $1 ORDER BY created_at DESC LIMIT 10",
    [duelId]
  );

  const p1 = await pool.query("SELECT telegram_id, clown_name, first_name, username FROM users WHERE telegram_id = $1", [d.player1_id]);
  const p2 = await pool.query("SELECT telegram_id, clown_name, first_name, username FROM users WHERE telegram_id = $1", [d.player2_id]);

  const myState = states.rows.find(s => String(s.user_id) === String(userId));
  const availableActions = (d.status === 'active' && String(d.current_turn_user) === String(userId))
    ? getAvailableActions(myState)
    : null;

  res.json({
    duel: {
      id: d.id,
      player1_id: d.player1_id,
      player2_id: d.player2_id,
      status: d.status,
      winner_id: d.winner_id,
      current_turn_user: d.current_turn_user,
      created_at: d.created_at,
      finished_at: d.finished_at,
    },
    players: {
      [d.player1_id]: {
        ...(p1.rows[0] || {}),
        state: states.rows.find(s => String(s.user_id) === String(d.player1_id)),
      },
      [d.player2_id]: {
        ...(p2.rows[0] || {}),
        state: states.rows.find(s => String(s.user_id) === String(d.player2_id)),
      },
    },
    my_id: userId,
    is_my_turn: d.status === 'active' && String(d.current_turn_user) === String(userId),
    available_actions: availableActions,
    recent_log: log.rows,
    max_turns: getMaxTurns(),
  });
}

// ===================== ACTIVE DUELS =====================
async function handleActive(req, res) {
  const userId = auth(req);

  const duels = await pool.query(
    `SELECT d.*,
       p1.clown_name AS p1_name, p1.first_name AS p1_first, p1.username AS p1_user,
       p2.clown_name AS p2_name, p2.first_name AS p2_first, p2.username AS p2_user
     FROM kafanski_duels d
     LEFT JOIN users p1 ON p1.telegram_id = d.player1_id
     LEFT JOIN users p2 ON p2.telegram_id = d.player2_id
     WHERE (d.player1_id = $1 OR d.player2_id = $1)
       AND d.status IN ('waiting', 'active')
     ORDER BY d.created_at DESC`,
    [userId]
  );

  const finished = await pool.query(
    `SELECT d.*,
       p1.clown_name AS p1_name, p1.first_name AS p1_first, p1.username AS p1_user,
       p2.clown_name AS p2_name, p2.first_name AS p2_first, p2.username AS p2_user
     FROM kafanski_duels d
     LEFT JOIN users p1 ON p1.telegram_id = d.player1_id
     LEFT JOIN users p2 ON p2.telegram_id = d.player2_id
     WHERE (d.player1_id = $1 OR d.player2_id = $1)
       AND d.status = 'finished'
       AND d.finished_at > NOW() - INTERVAL '24 hours'
     ORDER BY d.finished_at DESC
     LIMIT 5`,
    [userId]
  );

  const opponents = await pool.query(
    `SELECT telegram_id, clown_name, first_name, username, level FROM users WHERE telegram_id != $1 ORDER BY level DESC, first_name`,
    [userId]
  );

  res.json({
    my_id: userId,
    active: duels.rows,
    recent_finished: finished.rows,
    opponents: opponents.rows,
  });
}

// ===================== ACTION =====================
async function handleAction(req, res) {
  const userId = auth(req);
  const duelId = req.query.id;
  const { action } = req.body || {};

  if (!duelId) return res.status(400).json({ error: "Missing duel id" });
  if (!action || !ACTIONS[action]) return res.status(400).json({ error: "Nepoznata akcija" });

  const duel = await pool.query(
    "SELECT * FROM kafanski_duels WHERE id = $1 AND status = 'active'",
    [duelId]
  );
  if (duel.rowCount === 0) return res.status(404).json({ error: "Duel nije aktivan" });

  const d = duel.rows[0];
  if (String(d.current_turn_user) !== String(userId)) {
    return res.status(400).json({ error: "Nije tvoj red!" });
  }

  const stateRes = await pool.query(
    "SELECT * FROM duel_player_state WHERE duel_id = $1 AND user_id = $2",
    [duelId, userId]
  );
  if (stateRes.rowCount === 0) return res.status(404).json({ error: "State not found" });

  const currentState = stateRes.rows[0];
  const stateObj = {
    alcometer: currentState.alcometer,
    respect: currentState.respect,
    stomak: currentState.stomak,
    novcanik: currentState.novcanik,
    turn_number: currentState.turn_number,
    pijani_foulovi: currentState.pijani_foulovi,
  };

  const result = applyAction(stateObj, action);
  if (result.error) return res.status(400).json({ error: result.error });

  const { newState, flavorText } = result;

  await pool.query(
    `UPDATE duel_player_state
     SET alcometer = $1, respect = $2, stomak = $3, novcanik = $4, turn_number = $5, pijani_foulovi = $6
     WHERE duel_id = $7 AND user_id = $8`,
    [newState.alcometer, newState.respect, newState.stomak, newState.novcanik, newState.turn_number, newState.pijani_foulovi, duelId, userId]
  );

  await pool.query(
    `INSERT INTO duel_actions_log (duel_id, user_id, turn_number, action_type, flavor_text)
     VALUES ($1, $2, $3, $4, $5)`,
    [duelId, userId, newState.turn_number, action, flavorText]
  );

  const lossReason = checkInstantLoss(newState);
  if (lossReason) {
    const winnerId = String(d.player1_id) === String(userId) ? d.player2_id : d.player1_id;
    await pool.query(
      "UPDATE kafanski_duels SET status = 'finished', winner_id = $2, finished_at = NOW() WHERE id = $1",
      [duelId, winnerId]
    );
    return res.json({
      ok: true,
      flavor_text: flavorText,
      new_state: newState,
      game_over: true,
      loss_reason: lossReason,
      winner_id: winnerId,
    });
  }

  const otherState = await pool.query(
    "SELECT * FROM duel_player_state WHERE duel_id = $1 AND user_id != $2",
    [duelId, userId]
  );
  const otherTurn = otherState.rows[0]?.turn_number || 0;

  if (newState.turn_number >= getMaxTurns() && otherTurn >= getMaxTurns()) {
    const myScore = calculateScore(newState);
    const oppState = {
      alcometer: otherState.rows[0].alcometer,
      respect: otherState.rows[0].respect,
      stomak: otherState.rows[0].stomak,
      novcanik: otherState.rows[0].novcanik,
      turn_number: otherState.rows[0].turn_number,
      pijani_foulovi: otherState.rows[0].pijani_foulovi,
    };
    const oppScore = calculateScore(oppState);

    let winnerId;
    if (myScore > oppScore) winnerId = userId;
    else if (oppScore > myScore) winnerId = otherState.rows[0].user_id;
    else winnerId = Math.random() > 0.5 ? userId : otherState.rows[0].user_id;

    await pool.query(
      "UPDATE kafanski_duels SET status = 'finished', winner_id = $2, finished_at = NOW() WHERE id = $1",
      [duelId, winnerId]
    );

    return res.json({
      ok: true,
      flavor_text: flavorText,
      new_state: newState,
      game_over: true,
      winner_id: winnerId,
      my_score: myScore,
      opp_score: oppScore,
    });
  }

  const otherPlayerId = String(d.player1_id) === String(userId) ? d.player2_id : d.player1_id;
  await pool.query(
    "UPDATE kafanski_duels SET current_turn_user = $2 WHERE id = $1",
    [duelId, otherPlayerId]
  );

  res.json({
    ok: true,
    flavor_text: flavorText,
    new_state: newState,
    game_over: false,
  });
}
