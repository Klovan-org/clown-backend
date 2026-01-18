import { pool } from "../lib/db.js";

export default async function handler(req, res) {
  const key = req.query.key;
  if (key !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  console.log("CRON HIT", new Date().toISOString());

  const r = await pool.query(`
    update users
    set level = 0,
        location = null,
        updated_at = now()
    where updated_at < now() - interval '5 minutes'
    returning telegram_id
  `);

  console.log("⏱️ inactivity reset:", r.rowCount);

  return res.json({ ok: true, reset_count: r.rowCount });
}
