import { pool } from "../lib/db.js";
import { verifyTelegramWebAppData } from "../lib/telegram.js";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-telegram-init-data");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const initData = req.headers["x-telegram-init-data"];

    if (!initData) {
      return res.status(401).json({ error: "Missing x-telegram-init-data header" });
    }

    let telegramId;
    try {
      telegramId = verifyTelegramWebAppData(initData);
    } catch (err) {
      return res.status(401).json({ error: err.message });
    }

    // Check current level
    const current = await pool.query(
      `SELECT level FROM users WHERE telegram_id = $1`,
      [telegramId]
    );

    if (current.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const currentLevel = current.rows[0].level ?? 0;
    if (currentLevel <= 0) {
      return res.status(400).json({ error: "Already at minimum level (0)" });
    }

    // Decrease level
    const result = await pool.query(
      `UPDATE users
       SET level = GREATEST(COALESCE(level, 0) - 1, 0), updated_at = NOW()
       WHERE telegram_id = $1
       RETURNING level`,
      [telegramId]
    );

    res.json({ level: result.rows[0].level });
  } catch (err) {
    console.error("POST /api/level-down error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
