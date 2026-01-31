import { pool } from "../lib/db.js";
import { verifyTelegramWebAppData } from "../lib/telegram.js";
import { sendStatusNotification } from "../lib/bot.js";

const MAX_LEVEL = 6;
const MAX_TEXT_LENGTH = 200;

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

  console.log("=== POST /api/update-user-status ===");
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Body:", req.body);

  try {
    const initData = req.headers["x-telegram-init-data"];
    console.log("initData:", initData ? initData.substring(0, 100) + "..." : "MISSING");

    if (!initData) {
      console.log("ERROR: Missing x-telegram-init-data header");
      return res.status(401).json({ error: "Missing x-telegram-init-data header" });
    }

    let requestingUserId;
    try {
      requestingUserId = verifyTelegramWebAppData(initData);
      console.log("Requesting user telegramId:", requestingUserId);
    } catch (err) {
      console.log("Verification ERROR:", err.message);
      return res.status(401).json({ error: err.message, details: "initData verification failed" });
    }

    const { target_telegram_id, location, status_message, level } = req.body;
    console.log("Target telegram_id:", target_telegram_id);

    if (!target_telegram_id) {
      return res.status(400).json({ error: "Missing target_telegram_id" });
    }

    // Validate lengths
    if (location !== undefined && location !== null && location.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: `Location too long (max ${MAX_TEXT_LENGTH} chars)` });
    }
    if (status_message !== undefined && status_message !== null && status_message.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: `Status message too long (max ${MAX_TEXT_LENGTH} chars)` });
    }

    // Validate and parse level
    let parsedLevel = level;
    if (level !== undefined && level !== null) {
      parsedLevel = typeof level === 'string' ? parseInt(level, 10) : level;
      console.log("Parsed level:", parsedLevel);
      if (typeof parsedLevel !== 'number' || isNaN(parsedLevel) || parsedLevel < 0 || parsedLevel > MAX_LEVEL) {
        console.log("Level validation failed");
        return res.status(400).json({ error: `Invalid level (must be 0-${MAX_LEVEL})` });
      }
    }

    // Check if target user exists
    const exists = await pool.query(
      `SELECT 1 FROM users WHERE telegram_id = $1`,
      [target_telegram_id]
    );

    if (exists.rowCount === 0) {
      return res.status(404).json({ error: "Target user not found" });
    }

    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (location !== undefined) {
      updates.push(`location = $${paramIndex++}`);
      values.push(location);
    }

    if (status_message !== undefined) {
      updates.push(`status_message = $${paramIndex++}`);
      values.push(status_message);
    }

    if (parsedLevel !== undefined && parsedLevel !== null) {
      updates.push(`level = $${paramIndex++}`);
      values.push(parsedLevel);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    updates.push("updated_at = NOW()");
    values.push(target_telegram_id);

    const query = `UPDATE users SET ${updates.join(", ")} WHERE telegram_id = $${paramIndex}`;
    console.log("Update query:", query);
    console.log("Values:", values);

    await pool.query(query, values);

    // Pošalji notifikaciju u grupu za target usera
    console.log("Sending notification for target telegramId:", target_telegram_id);
    await sendStatusNotification(target_telegram_id);
    console.log("Notification sent");

    res.json({ ok: true, updated_user: target_telegram_id });
  } catch (err) {
    console.error("POST /api/update-user-status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
