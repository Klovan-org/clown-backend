import { verifyTelegramWebAppData } from "../lib/telegram.js";
import { bot } from "../lib/bot.js";

const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-telegram-init-data");
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const initData = req.headers["x-telegram-init-data"];
    if (!initData) {
      return res.status(401).json({ error: "Nisi prijavljen", member: false });
    }

    const telegramId = verifyTelegramWebAppData(initData);

    if (!GROUP_CHAT_ID) {
      // No group configured - allow everyone
      return res.json({ member: true });
    }

    const chatMember = await bot.telegram.getChatMember(GROUP_CHAT_ID, telegramId);
    const allowedStatuses = ["member", "administrator", "creator"];
    const isMember = allowedStatuses.includes(chatMember.status);

    return res.json({ member: isMember, status: chatMember.status });
  } catch (err) {
    console.error("check-member error:", err.message);
    return res.status(403).json({ error: "Neuspesna provera", member: false });
  }
}
