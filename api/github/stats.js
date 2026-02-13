import { pool } from "../../lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const contributors = await pool.query(
      `SELECT github_username, github_avatar_url, invite_status, invited_at
       FROM github_contributors
       ORDER BY invited_at DESC`
    );

    const stats = await pool.query(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE invite_status = 'pending') as pending,
         COUNT(*) FILTER (WHERE invite_status = 'accepted') as accepted
       FROM github_contributors`
    );

    res.json({
      contributors: contributors.rows,
      stats: stats.rows[0]
    });
  } catch (err) {
    console.error("GET /api/github/stats error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
