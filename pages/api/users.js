import { pool } from "@/lib/db";

export default async function handler(req, res) {
  try {
    const r = await pool.query(
      `SELECT telegram_id, username, first_name, clown_name, 
              level, location, status_message, updated_at
       FROM users
       ORDER BY level DESC, updated_at DESC`
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}