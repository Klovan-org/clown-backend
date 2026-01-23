import "dotenv/config";
import express from "express";
import cors from 'cors';
import { bot, sendStatusNotification } from "./lib/bot.js";
import { pool } from "./lib/db.js";
import { verifyTelegramWebAppData } from "./lib/telegram.js";

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_LEVEL = 6;
const MAX_TEXT_LENGTH = 200;

app.use(express.json());

// CORS for mini-app
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-telegram-init-data']
}));

/* ======================
   HEALTH CHECK
====================== */

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "clown-backend" });
});

/* ======================
   WEBHOOK (Telegram Bot)
====================== */

app.post("/webhook", (req, res) => {
  bot.handleUpdate(req.body, res).catch((err) => {
    console.error("Webhook error:", err);
    res.sendStatus(500);
  });
});

/* ======================
   API: GET /api/users
   Returns all users ordered by level DESC, updated_at DESC
====================== */

app.get("/api/users", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        telegram_id,
        username,
        first_name,
        clown_name,
        level,
        location,
        status_message,
        updated_at
      FROM users
      ORDER BY level DESC, updated_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/users error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ======================
   API: POST /api/level-up
   Increases user level (max 6)
   Requires x-telegram-init-data header
====================== */

app.post("/api/level-up", async (req, res) => {
  console.log("=== POST /api/level-up ===");
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

    // Pošalji notifikaciju u grupu
    await sendStatusNotification(telegramId);

    res.json({ level: result.rows[0].level });
  } catch (err) {
    console.error("POST /api/level-up error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ======================
   API: POST /api/update-profile
   Updates user location, status_message, and/or level
   Requires x-telegram-init-data header
====================== */

app.post("/api/update-profile", async (req, res) => {
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

    const { location, status_message, level } = req.body;

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
      if (typeof parsedLevel !== 'number' || isNaN(parsedLevel) || parsedLevel < 0 || parsedLevel > 6) {
        return res.status(400).json({ error: 'Invalid level (must be 0-6)' });
      }
    }

    // Check if user exists
    const exists = await pool.query(
      `SELECT 1 FROM users WHERE telegram_id = $1`,
      [telegramId]
    );

    if (exists.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
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
    values.push(telegramId);

    const query = `UPDATE users SET ${updates.join(", ")} WHERE telegram_id = $${paramIndex}`;
    console.log("Update query:", query);
    console.log("Values:", values);

    await pool.query(query, values);

    // Pošalji notifikaciju u grupu
    console.log("Sending notification for telegramId:", telegramId);
    await sendStatusNotification(telegramId);
    console.log("Notification sent");

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/update-profile error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ======================
   START SERVER
====================== */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
