// pages/api/update-profile.js
import { pool } from "@/db";
import { verifyTelegramWebAppData } from "@/utils/telegram";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const initData = req.headers["x-telegram-init-data"];
    const telegramId = verifyTelegramWebAppData(initData);

    const { location, status_message } = req.body;

    await pool.query(
      `UPDATE users
       SET location = $1, status_message = $2, updated_at = NOW()
       WHERE telegram_id = $3`,
      [location || null, status_message || null, telegramId]
    );

    // Schedule status notification
    // await scheduleStatusNotification(telegramId);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}