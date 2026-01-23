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

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  console.log("=== POST /api/reset-profile ===");

  try {
    const initData = req.headers["x-telegram-init-data"];

    if (!initData) {
      return res.status(401).json({ error: "Missing x-telegram-init-data header" });
    }

    let telegramId;
    try {
      telegramId = verifyTelegramWebAppData(initData);
      console.log("Verified telegramId:", telegramId);
    } catch (err) {
      return res.status(401).json({ error: err.message });
    }

    // Reset level, location, and status_message
    const result = await pool.query(
      `UPDATE users
       SET level = 0, location = NULL, status_message = NULL, updated_at = NOW()
       WHERE telegram_id = $1
       RETURNING level, location, status_message`,
      [telegramId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ ok: true, level: 0, location: null, status_message: null });
  } catch (err) {
    console.error("POST /api/reset-profile error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
