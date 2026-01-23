// pages/api/level-up.js (ili app/api/level-up/route.js)
import { pool } from "@/db";
import { verifyTelegramWebAppData } from "@/utils/telegram"; // implementiraj ovu funkciju!

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const initData = req.headers["x-telegram-init-data"];
    const telegramId = verifyTelegramWebAppData(initData); // Verifikuj da je zahtev iz Telegrama!

    const MAX_LEVEL = 6;
    const r = await pool.query(
      `UPDATE users
       SET level = LEAST(COALESCE(level, 0) + 1, $2), updated_at = NOW()
       WHERE telegram_id = $1
       RETURNING level`,
      [telegramId, MAX_LEVEL]
    );

    // Schedule status notification (tvoja postojeća funkcija)
    // await scheduleStatusNotification(telegramId);

    res.json({ level: r.rows[0]?.level });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}