import { pool } from "../lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

  const r = await pool.query(`
    select telegram_id, username, first_name, clown_name, level, location, status_message, updated_at
    from users
    order by updated_at desc
    limit 200
  `);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(r.rows);
}