import { pool } from "../lib/db.js";
import { verifyTelegramWebAppData } from "../lib/telegram.js";

const MAX_LEVEL = 6;

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

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  console.log("=== POST /api/level-up ===");
  console.log("Headers:", JSON.stringify(req.headers, null, 2));

  try {
    const initData = req.headers["x-telegram-init-data"];
    console.log("initData:", initData ? initData.substring(0, 100) + "..." : "MISSING");

    if (!initData) {
      console.log("ERROR: Missing x-telegram-init-data header");
      return res.status(401).json({ error: "Missing x-telegram-init-data header" });
    }

    let telegramId;
    try {
      telegramId = verifyTelegramWebAppData(initData);
      console.log("Verified telegramId:", telegramId);
    } catch (err) {
      console.log("Verification ERROR:", err.message);
      return res.status(401).json({ error: err.message, details: "initData verification failed" });
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
    if (currentLevel >= MAX_LEVEL) {
      return res.status(400).json({ error: `Already at max level (${MAX_LEVEL})` });
    }

    // Increase level
    const result = await pool.query(
      `UPDATE users
       SET level = LEAST(COALESCE(level, 0) + 1, $2), updated_at = NOW()
       WHERE telegram_id = $1
       RETURNING level`,
      [telegramId, MAX_LEVEL]
    );

    res.json({ level: result.rows[0].level });
  } catch (err) {
    console.error("POST /api/level-up error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
