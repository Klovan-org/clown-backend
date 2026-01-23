import { pool } from "./db.js";

const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;
const MAX_LEVEL = 6;

export async function sendStatusNotificationById(telegramId) {
  if (!GROUP_CHAT_ID || !BOT_TOKEN) return;

    const r = await pool.query(
        `SELECT first_name, clown_name, username, level, location, status_message
             FROM users
                  WHERE telegram_id = $1`,
                      [telegramId]
                        );

                          const user = r.rows[0];
                            if (!user) return;

                              const userName = user.clown_name || user.first_name || (user.username ? `@${user.username}` : "Klovn");

                                let statusMsg = `🤡 ${userName}\n`;
                                  statusMsg += `🎚️ Level: ${user.level ?? 0}/${MAX_LEVEL}\n`;
                                    statusMsg += `📍 Lokacija: ${user.location || "—"}\n`;
                                      if (user.status_message) statusMsg += `💬 Status: ${user.status_message}`;

                                        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
                                          const resp = await fetch(url, {
                                              method: "POST",
                                                  headers: { "Content-Type": "application/json" },
                                                      body: JSON.stringify({
                                                            chat_id: GROUP_CHAT_ID,
                                                                  text: statusMsg,
                                                                        disable_web_page_preview: true,
                                                                            }),
                                                                              });

                                                                                if (!resp.ok) {
                                                                                    const t = await resp.text();
                                                                                        console.error("sendMessage failed:", resp.status, t);
                                                                                          }
                                                                                          }