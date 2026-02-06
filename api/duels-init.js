import { pool } from "../lib/db.js";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-telegram-init-data");
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
      CREATE TABLE IF NOT EXISTS kafanski_duels (
        id SERIAL PRIMARY KEY,
        player1_id BIGINT NOT NULL,
        player2_id BIGINT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'waiting',
        winner_id BIGINT,
        current_turn_user BIGINT,
        created_at TIMESTAMP DEFAULT NOW(),
        finished_at TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS duel_player_state (
        id SERIAL PRIMARY KEY,
        duel_id INTEGER NOT NULL REFERENCES kafanski_duels(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL,
        alcometer INTEGER NOT NULL DEFAULT 0,
        respect INTEGER NOT NULL DEFAULT 50,
        stomak INTEGER NOT NULL DEFAULT 50,
        novcanik INTEGER NOT NULL DEFAULT 500,
        turn_number INTEGER NOT NULL DEFAULT 0,
        pijani_foulovi INTEGER NOT NULL DEFAULT 0,
        UNIQUE(duel_id, user_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS duel_actions_log (
        id SERIAL PRIMARY KEY,
        duel_id INTEGER NOT NULL REFERENCES kafanski_duels(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL,
        turn_number INTEGER NOT NULL,
        action_type VARCHAR(30) NOT NULL,
        flavor_text TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    res.json({ ok: true, message: "Duel tables created" });
  } catch (err) {
    console.error("duels-init error:", err);
    res.status(500).json({ error: err.message });
  }
}
