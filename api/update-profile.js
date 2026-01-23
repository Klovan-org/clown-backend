import { pool } from "../lib/db.js";
import { verifyTelegramWebAppData } from "../lib/telegram.js";
import { sendStatusNotificationById } from "../lib/groupNotify.js"; // putanja po tvojoj strukturi


const MAX_TEXT_LENGTH = 200;
const MAX_LEVEL = 6; // ✅ DODAJ OVO

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

  console.log("=== POST /api/update-profile ===");
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Body:", req.body);

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

    // ✅ PROMENI OVU LINIJU (dodaj level)
    const { level, location, status_message } = req.body || {};

    // ✅ DODAJ OVAJ BLOK (validacija level-a)
    if (level !== undefined && level !== null) {
      const n = Number(level);
      if (!Number.isInteger(n) || n < 0 || n > MAX_LEVEL) {
        return res.status(400).json({ error: `Invalid level (0-${MAX_LEVEL})` });
      }
    }

    // Validate lengths (postojeće)
    if (location !== undefined && location !== null && location.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: `Location too long (max ${MAX_TEXT_LENGTH} chars)` });
    }
    if (status_message !== undefined && status_message !== null && status_message.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: `Status message too long (max ${MAX_TEXT_LENGTH} chars)` });
    }

    // Check if user exists (postojeće)
    const exists = await pool.query(
      `SELECT 1 FROM users WHERE telegram_id = $1`,
      [telegramId]
    );
    if (exists.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    // Build dynamic update query (postojeće + dodaj level)
    const updates = [];
    const values = [];
    let paramIndex = 1;

    // ✅ DODAJ OVO (update level-a)
    if (level !== undefined) {
      updates.push(`level = $${paramIndex++}`);
      values.push(level);
    }

    if (location !== undefined) {
      updates.push(`location = $${paramIndex++}`);
      values.push(location);
    }
    if (status_message !== undefined) {
      updates.push(`status_message = $${paramIndex++}`);
      values.push(status_message);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    updates.push("updated_at = NOW()");
    values.push(telegramId);

    await pool.query(
      `UPDATE users SET ${updates.join(", ")} WHERE telegram_id = $${paramIndex}`,
      values
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/update-profile error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}


// ... posle UPDATE users ...
await sendStatusNotificationById(telegramId);

