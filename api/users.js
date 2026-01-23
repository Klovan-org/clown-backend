import { pool } from "../lib/db.js";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-telegram-init-data");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const r = await pool.query(`
      SELECT telegram_id, username, first_name, clown_name, level, location, status_message, updated_at
      FROM users
      ORDER BY level DESC, updated_at DESC
      LIMIT 200
    `);

    res.json(r.rows);
  } catch (err) {
    console.error("GET /api/users error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}