import { Telegraf, Markup } from "telegraf";
import { pool } from "./db.js";

export const bot = new Telegraf(process.env.BOT_TOKEN);
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;

/* ======================
   HELPERS
====================== */

const MAX_LEVEL = 6;
const MAX_INLINE_TEXT = 200;

function isPrivateChat(ctx) {
  return ctx.chat?.type === 'private';
}

// Format status poruke
function formatStatus(user) {
  let text = `🤡 Level: ${user.level ?? 0}/${MAX_LEVEL}\n`;
  text += `📍 Lokacija: ${user.location || "—"}\n`;
  
  if (user.status_message) {
    text += `💬 Status: ${user.status_message}\n`;
  }
  
  text += `🕒 ${user.updated_at}`;
  
  return text;
}

// Šalje kompletan status u grupu ODMAH
export async function sendStatusNotification(telegramId) {
  if (!GROUP_CHAT_ID) return;

  try {
    // Uzmi kompletan status korisnika
    const r = await pool.query(
      `SELECT first_name, clown_name, username, level, location, status_message
       FROM users
       WHERE telegram_id = $1`,
      [telegramId]
    );

    const user = r.rows[0];
    if (!user) return;

    const userName = user.clown_name || user.first_name || user.username || "Klovn";

    // Formatiraj status poruku
    let statusMsg = `🤡 ${userName}\n`;
    statusMsg += `🎚️ Level: ${user.level ?? 0}\n`;
    statusMsg += `📍 Lokacija: ${user.location || "—"}\n`;

    if (user.status_message) {
      statusMsg += `💬 Status: ${user.status_message}`;
    }

    // Pošalji u grupu
    await bot.telegram.sendMessage(GROUP_CHAT_ID, statusMsg);
  } catch (err) {
    console.error("Failed to send status notification:", err);
  }
}

async function isMember(telegramId) {
  const r = await pool.query(`select 1 from users where telegram_id=$1`, [telegramId]);
  return r.rowCount > 0;
}

async function upsertUser(from) {
  await pool.query(
    `insert into users (telegram_id, username, first_name, updated_at)
     values ($1,$2,$3,now())
     on conflict (telegram_id) do update
       set username=excluded.username,
           first_name=excluded.first_name,
           updated_at=now()`,
    [from.id, from.username || null, from.first_name || null]
  );
}

async function getUserName(from) {
  const r = await pool.query(
    `select clown_name, first_name, username from users where telegram_id=$1`,
    [from.id]
  );
  const u = r.rows[0];
  return u?.clown_name || u?.first_name || u?.username || "Klovn";
}

/* ======================
   /START (PRIVATE)
====================== */

bot.start(async (ctx) => {
  const payload = ctx.startPayload;

  // već je član
  if (await isMember(ctx.from.id)) {
    return ctx.reply("🤡 Već si unutra.");
  }

  // mora invite
  if (!payload || !payload.startsWith("INV_")) {
    return ctx.reply("⛔ Pristup samo uz pozivnicu.");
  }

  const inv = await pool.query(
    `select code, max_uses, uses, active
     from invites
     where code=$1`,
    [payload]
  );

  if (inv.rowCount === 0 || !inv.rows[0].active) {
    return ctx.reply("⛔ Pozivnica nije validna.");
  }

  const { max_uses, uses } = inv.rows[0];
  if (max_uses && uses >= max_uses) {
    return ctx.reply("⛔ Pozivnica je potrošena.");
  }

  // upiši usera
  await upsertUser(ctx.from);

  // potroši invite
  await pool.query(`update invites set uses=uses+1 where code=$1`, [payload]);

  const userName = await getUserName(ctx.from);

  // Instant notifikacija za novi član (bez delay-a)
  if (GROUP_CHAT_ID) {
    try {
      await bot.telegram.sendMessage(GROUP_CHAT_ID, `🎉 Novi klovn se pridružio: ${userName}!`);
    } catch (err) {
      console.error("Failed to send group notification:", err);
    }
  }

  return ctx.reply("✅ Dobrodošao klovne 🤡");
});

/* ======================
   INLINE GROUP COMMANDS
   Enable in BotFather: /setinline -> Enable
====================== */

bot.on("inline_query", async (ctx) => {
  const raw = (ctx.inlineQuery?.query || "").trim();
  const results = [];

  const addArticle = (id, title, description, messageText, keyboard) => {
    results.push({
      type: "article",
      id,
      title,
      description,
      input_message_content: { message_text: messageText },
      reply_markup: keyboard?.reply_markup,
    });
  };

  // Palette when user types only "@bot"
  if (!raw) {
    addArticle(
      "p_status",
      "💬 status <tekst>",
      "Postavi status bez spama",
      "💬 status <tekst>",
      Markup.inlineKeyboard([[Markup.button.callback("❌ Close", "ig:close")]])
    );
    addArticle(
      "p_loc",
      "📍 lokacija <tekst>",
      "Postavi lokaciju bez spama",
      "📍 lokacija <tekst>",
      Markup.inlineKeyboard([[Markup.button.callback("❌ Close", "ig:close")]])
    );
    addArticle(
      "p_show",
      "🤡 show",
      "Ubacuje poruku sa tvojim statusom",
      "🤡 Moj status",
      Markup.inlineKeyboard([
        [Markup.button.callback("🔄 Refresh", "ig:showstatus")],
        [Markup.button.callback("❌ Close", "ig:close")],
      ])
    );

    return ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });
  }

  const [cmdRaw] = raw.split(/\s+/).filter(Boolean);
  const cmd = (cmdRaw || "").toLowerCase();
  const argText = raw.slice((cmdRaw || "").length).trim();

  // status <text>
  if (cmd === "status") {
    const text = argText;

    if (!text) {
      addArticle(
        "status_help",
        "💬 status <tekst>",
        "Primer: @bot status Pijem kafu ☕",
        "💬 status <tekst>",
        Markup.inlineKeyboard([[Markup.button.callback("❌ Close", "ig:close")]])
      );
      return ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });
    }

    if (text.length > MAX_INLINE_TEXT) {
      addArticle(
        "status_too_long",
        "⚠️ Predugačko",
        `Max ${MAX_INLINE_TEXT} karaktera.`,
        `⚠️ Status je predugačak (max ${MAX_INLINE_TEXT}).`,
        Markup.inlineKeyboard([[Markup.button.callback("❌ Close", "ig:close")]])
      );
      return ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });
    }

    await upsertUser(ctx.from);

    await pool.query(
      `update users
       set status_message=$1, updated_at=now()
       where telegram_id=$2`,
      [text, ctx.from.id]
    );

    await sendStatusNotification(ctx.from.id);

    addArticle(
      "status_ok",
      "✅ Status sačuvan",
      "Ne moraš ništa slati u grupu.",
      "✅ Status sačuvan.",
      Markup.inlineKeyboard([[Markup.button.callback("❌ Close", "ig:close")]])
    );

    return ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });
  }

  // lokacija <text>
  if (cmd === "lokacija" || cmd === "loc" || cmd === "location") {
    const text = argText;

    if (!text) {
      addArticle(
        "loc_help",
        "📍 lokacija <tekst>",
        "Primer: @bot lokacija Kafana Kod Mike",
        "📍 lokacija <tekst>",
        Markup.inlineKeyboard([[Markup.button.callback("❌ Close", "ig:close")]])
      );
      return ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });
    }

    if (text.length > MAX_INLINE_TEXT) {
      addArticle(
        "loc_too_long",
        "⚠️ Predugačko",
        `Max ${MAX_INLINE_TEXT} karaktera.`,
        `⚠️ Lokacija je predugačka (max ${MAX_INLINE_TEXT}).`,
        Markup.inlineKeyboard([[Markup.button.callback("❌ Close", "ig:close")]])
      );
      return ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });
    }

    await upsertUser(ctx.from);

    await pool.query(
      `update users
       set location=$1, updated_at=now()
       where telegram_id=$2`,
      [text, ctx.from.id]
    );

    await sendStatusNotification(ctx.from.id);

    addArticle(
      "loc_ok",
      "✅ Lokacija sačuvana",
      "Ne moraš ništa slati u grupu.",
      "📍 Lokacija sačuvana.",
      Markup.inlineKeyboard([[Markup.button.callback("❌ Close", "ig:close")]])
    );

    return ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });
  }

  // show
  if (cmd === "show" || cmd === "moj" || cmd === "me") {
    addArticle(
      "showstatus",
      "🤡 Moj status",
      "Klikni da ubaciš poruku sa statusom",
      "🤡 Moj status",
      Markup.inlineKeyboard([
        [Markup.button.callback("🔄 Refresh", "ig:showstatus")],
        [Markup.button.callback("❌ Close", "ig:close")],
      ])
    );
    return ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });
  }

  // fallback: show palette
  addArticle(
    "p_status2",
    "💬 status <tekst>",
    "Postavi status: @bot status ...",
    "💬 status <tekst>",
    Markup.inlineKeyboard([[Markup.button.callback("❌ Close", "ig:close")]])
  );
  addArticle(
    "p_loc2",
    "📍 lokacija <tekst>",
    "Postavi lokaciju: @bot lokacija ...",
    "📍 lokacija <tekst>",
    Markup.inlineKeyboard([[Markup.button.callback("❌ Close", "ig:close")]])
  );
  addArticle(
    "p_show2",
    "🤡 show",
    "Ubacuje poruku sa statusom",
    "🤡 Moj status",
    Markup.inlineKeyboard([
      [Markup.button.callback("🔄 Refresh", "ig:showstatus")],
      [Markup.button.callback("❌ Close", "ig:close")],
    ])
  );

  return ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });
});

/* ======================
   INLINE CALLBACKS
====================== */

bot.on("callback_query", async (ctx) => {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("ig:")) return;

  await ctx.answerCbQuery().catch(() => {});
  const cmd = data.slice(3);

  if (cmd === "close") {
    try {
      await ctx.deleteMessage();
    } catch {
      try {
        await ctx.editMessageText("✅ Gotovo.");
      } catch {}
    }
    return;
  }

  if (cmd === "showstatus") {
    try {
      const r = await pool.query(
        `select level, location, status_message, updated_at
         from users where telegram_id=$1`,
        [ctx.from.id]
      );

      const u = r.rows[0];
      const text = u ? formatStatus(u) : "Nisi u bazi.";

      await ctx.editMessageText(
        text,
        Markup.inlineKeyboard([
          [Markup.button.callback("🔄 Refresh", "ig:showstatus")],
          [Markup.button.callback("❌ Close", "ig:close")],
        ])
      );
    } catch (err) {
      console.error("Failed inline showstatus:", err);
    }
    return;
  }
});

/* ======================
   PRIVATE CHAT COMMANDS
====================== */

// /invite - generiše invite link
bot.command("invite", async (ctx) => {
  if (!isPrivateChat(ctx)) return;
  if (!(await isMember(ctx.from.id))) return ctx.reply("⛔ Nisi član.");

  try {
    const code = `INV_${ctx.from.id}_${Date.now().toString(36)}`;
    await pool.query(
      `INSERT INTO invites (code, max_uses, uses, active)
       VALUES ($1, 1, 0, true)`,
      [code]
    );

    const botInfo = await bot.telegram.getMe();
    const link = `https://t.me/${botInfo.username}?start=${code}`;

    return ctx.reply(
      `🎟️ Tvoja pozivnica (1 korišćenje):\n\n${link}\n\nPošalji ovaj link osobi koju želiš da pozoveš.`
    );
  } catch (err) {
    console.error("Invite error:", err);
    return ctx.reply("❌ Greška pri kreiranju pozivnice.");
  }
});

// /app - otvara mini app
bot.command("app", async (ctx) => {
  if (!isPrivateChat(ctx)) return;

  const MINI_APP_URL = process.env.DASHBOARD_URL;
  if (!MINI_APP_URL) return ctx.reply("❌ App nije podešen.");

  return ctx.reply("🤡 Otvori Klovn App:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📊 Otvori App", web_app: { url: MINI_APP_URL } }],
      ],
    },
  });
});

// /group - pošalji link grupe
bot.command("group", async (ctx) => {
  if (!isPrivateChat(ctx)) return;
  if (!(await isMember(ctx.from.id))) return ctx.reply("⛔ Nisi član.");
  if (!GROUP_CHAT_ID) return ctx.reply("❌ Grupa nije podešena.");

  try {
    const link = await bot.telegram.exportChatInviteLink(GROUP_CHAT_ID);
    return ctx.reply(`🤡 Link za grupu:\n\n${link}`);
  } catch (err) {
    console.error("Group link error:", err);
    return ctx.reply("❌ Greška pri generisanju linka.");
  }
});

// /status - prikaži svoj status
bot.command("status", async (ctx) => {
  if (!isPrivateChat(ctx)) return;
  if (!(await isMember(ctx.from.id))) return ctx.reply("⛔ Nisi član.");

  const r = await pool.query(
    `SELECT level, location, status_message, updated_at FROM users WHERE telegram_id=$1`,
    [ctx.from.id]
  );
  const u = r.rows[0];
  if (!u) return ctx.reply("Nisi u bazi.");
  return ctx.reply(formatStatus(u));
});

/* ======================
   ADMIN COMMANDS (PRIVATE)
====================== */

bot.command("setup_menu", async (ctx) => {
  if (!isPrivateChat(ctx)) return;

  const MINI_APP_URL = process.env.DASHBOARD_URL;
  if (!MINI_APP_URL) return ctx.reply("❌ DASHBOARD_URL nije podešen u .env");

  try {
    if (GROUP_CHAT_ID) {
      const msg = await bot.telegram.sendMessage(
        GROUP_CHAT_ID,
        "🤡 **KLOVN DASHBOARD**\n\nKlikni dugme da vidiš sve klovnove u realnom vremenu!",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "📊 Otvori Dashboard", web_app: { url: MINI_APP_URL } }],
            ],
          },
        }
      );
      await bot.telegram.pinChatMessage(GROUP_CHAT_ID, msg.message_id);
    }
    ctx.reply("✅ Setup gotov!");
  } catch (err) {
    console.error("Setup error:", err);
    ctx.reply(`❌ Greška: ${err.message}`);
  }
});

bot.command("test", async (ctx) => {
  if (!isPrivateChat(ctx)) return;
  ctx.reply("✅ Bot radi! DASHBOARD_URL=" + (process.env.DASHBOARD_URL || "NOT SET"));
});