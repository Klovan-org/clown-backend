import { pool } from "../lib/db.js";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-telegram-init-data, x-setup-secret");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

export default async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

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
    console.error("autobus-init error:", err);
    res.status(500).json({ error: err.message });
  }
}
