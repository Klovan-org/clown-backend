export default async function handler(req, res) {
  const {
    BOT_TOKEN,
    GROUP_CHAT_ID,
    BOT_USERNAME,   // npr: "ClownBot" (bez @)
    SETUP_SECRET,
  } = process.env;

  const secret = req.query.secret || req.headers["x-setup-secret"];
  if (!SETUP_SECRET || secret !== SETUP_SECRET) {
    return res.status(401).json({ ok: false, error: "unauthorized", version: "setup-pin-v4" });
  }

  if (!BOT_TOKEN || !GROUP_CHAT_ID || !BOT_USERNAME) {
    return res.status(500).json({
      ok: false,
      error: "Missing env: BOT_TOKEN / GROUP_CHAT_ID / BOT_USERNAME",
      version: "setup-pin-v4",
    });
  }

  const START_PARAM = "dashboard";
  const MINI_APP_LINK = `https://t.me/${BOT_USERNAME}?startapp=${encodeURIComponent(START_PARAM)}&mode=compact`;

  const api = (method) => `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

  try {
    // 1) sendMessage (form-urlencoded + reply_markup JSON string)
    const replyMarkup = JSON.stringify({
      inline_keyboard: [
        [{ text: "🚀 Launch", url: MINI_APP_LINK }],
      ],
    });

    const sendParams = new URLSearchParams();
    sendParams.set("chat_id", GROUP_CHAT_ID);
    sendParams.set("text", "🤡 KLOVN DASHBOARD\n\nKlikni 🚀 Launch da otvoriš mini app:");
    sendParams.set("disable_notification", "true");
    sendParams.set("reply_markup", replyMarkup);

    const sendResp = await fetch(api("sendMessage"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: sendParams.toString(),
    }).then((r) => r.json());

    if (!sendResp.ok) {
      return res.status(400).json({ ok: false, step: "sendMessage", sendResp, version: "setup-pin-v4" });
    }

    const message_id = sendResp.result.message_id;

    // 2) pinChatMessage (form-urlencoded)
    const pinParams = new URLSearchParams();
    pinParams.set("chat_id", GROUP_CHAT_ID);
    pinParams.set("message_id", String(message_id));
    pinParams.set("disable_notification", "true");

    const pinResp = await fetch(api("pinChatMessage"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: pinParams.toString(),
    }).then((r) => r.json());

    if (!pinResp.ok) {
      return res.status(200).json({
        ok: true,
        warning: "Pin failed (bot mora biti admin + Pin messages)",
        message_id,
        mini_app_link: MINI_APP_LINK,
        pinResp,
        version: "setup-pin-v4",
      });
    }

    return res.status(200).json({
      ok: true,
      message_id,
      mini_app_link: MINI_APP_LINK,
      version: "setup-pin-v4",
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, version: "setup-pin-v4" });
  }
}
