import { Telegraf, Markup } from "telegraf";
import { pool } from "./db.js";

export const bot = new Telegraf(process.env.BOT_TOKEN);
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;

/* ======================
   HELPERS
====================== */

const MAX_LEVEL = 6;
const MAX_INLINE_TEXT = 200;

// Map za čuvanje timeout-ova po korisniku
const notificationTimers = new Map();

function mainKeyboard() {
  return Markup.keyboard([
    ["🤡 Moj status", "🎚️ Level +1"],
    ["📍 Lokacija", "💬 Status poruka"],
    ["📊 Dashboard", "👥 Grupa"],
  ]).resize();
}

// Nova funkcija: šalje kompletan status u grupu sa delay-om (debounce)
async function scheduleStatusNotification(telegramId) {
  if (!GROUP_CHAT_ID) return;

  // Ako već postoji timer za ovog korisnika, poništi ga
  if (notificationTimers.has(telegramId)) {
    clearTimeout(notificationTimers.get(telegramId));
  }

  // Postavi novi timer za 45 sekundi
  const timer = setTimeout(async () => {
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

      // Ukloni timer iz mape
      notificationTimers.delete(telegramId);
    } catch (err) {
      console.error("Failed to send status notification:", err);
    }
  }, 45000); // 45 sekundi

  // Sačuvaj timer
  notificationTimers.set(telegramId, timer);
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
    return ctx.reply("🤡 Već si unutra.", mainKeyboard());
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

  return ctx.reply("✅ Dobrodošao klovne 🤡", mainKeyboard());
});

/* ======================
   DASHBOARD
====================== */

bot.hears("📊 Dashboard", async (ctx) => {
  const url = process.env.DASHBOARD_URL;
  if (!url || !url.startsWith("https://")) {
    return ctx.reply("Dashboard URL nije podešen.");
  }

  return ctx.reply(
    "📊 Otvori dashboard:",
    Markup.inlineKeyboard([Markup.button.webApp("📊 Dashboard", url)])
  );
});

/* ======================
   GRUPA
====================== */

bot.hears("👥 Grupa", async (ctx) => {
  const groupLink = process.env.GROUP_INVITE_LINK;
  if (!groupLink || !groupLink.startsWith("https://")) {
    return ctx.reply("Link za grupu nije podešen.");
  }

  return ctx.reply(
    "👥 Pridruži se grupi:",
    Markup.inlineKeyboard([Markup.button.url("👥 Otvori grupu", groupLink)])
  );
});

/* ======================
   LEVEL +1
====================== */

bot.hears("🎚️ Level +1", async (ctx) => {
  await upsertUser(ctx.from);

  // Proveri trenutni level
  const current = await pool.query(`select level from users where telegram_id=$1`, [ctx.from.id]);
  const currentLevel = current.rows[0]?.level ?? 0;

  if (currentLevel >= MAX_LEVEL) {
    return ctx.reply(`⚠️ Već si na maksimalnom levelu (${MAX_LEVEL})! 🤡`, mainKeyboard());
  }

  const r = await pool.query(
    `update users
     set level=least(coalesce(level,0)+1, $2), updated_at=now()
     where telegram_id=$1
     returning level`,
    [ctx.from.id, MAX_LEVEL]
  );

  // Schedule debounced notification
  await scheduleStatusNotification(ctx.from.id);

  return ctx.reply(`✅ Level: ${r.rows[0].level}`, mainKeyboard());
});

/* ======================
   STATUS
====================== */

bot.hears("🤡 Moj status", async (ctx) => {
  const r = await pool.query(
    `select level, location, status_message, updated_at
     from users where telegram_id=$1`,
    [ctx.from.id]
  );

  const u = r.rows[0];
  if (!u) return ctx.reply("Nisi u bazi.");

  let statusText = `🤡 Level: ${u.level ?? 0}/${MAX_LEVEL}\n📍 Lokacija: ${u.location || "—"}`;

  if (u.status_message) {
    statusText += `\n💬 Status: ${u.status_message}`;
  }

  statusText += `\n🕒 ${u.updated_at}`;

  return ctx.reply(statusText, mainKeyboard());
});

/* ======================
   LOKACIJA
====================== */

const pendingLocation = new Set();

bot.hears("📍 Lokacija", async (ctx) => {
  pendingLocation.add(ctx.from.id);
  return ctx.reply(
    "Upiši lokaciju (npr. 'Kafana Kod Mike'):",
    Markup.keyboard([["❌ Otkaži"]]).resize()
  );
});

bot.hears("❌ Otkaži", async (ctx) => {
  pendingLocation.delete(ctx.from.id);
  pendingStatus.delete(ctx.from.id);
  return ctx.reply("Otkazano.", mainKeyboard());
});

/* ======================
   STATUS PORUKA
====================== */

const pendingStatus = new Set();

bot.hears("💬 Status poruka", async (ctx) => {
  pendingStatus.add(ctx.from.id);
  return ctx.reply(
    "Upiši svoju status poruku (npr. 'Pijem kafu ☕'):",
    Markup.keyboard([["🗑️ Obriši status", "❌ Otkaži"]]).resize()
  );
});

bot.hears("🗑️ Obriši status", async (ctx) => {
  if (!pendingStatus.has(ctx.from.id)) return;

  pendingStatus.delete(ctx.from.id);

  await pool.query(
    `update users
     set status_message=null, updated_at=now()
     where telegram_id=$1`,
    [ctx.from.id]
  );

  // Schedule debounced notification
  await scheduleStatusNotification(ctx.from.id);

  return ctx.reply("🗑️ Status obrisan.", mainKeyboard());
});

/* ======================
   TEXT HANDLER
====================== */

bot.on("text", async (ctx) => {
  // Handle location
  if (pendingLocation.has(ctx.from.id)) {
    pendingLocation.delete(ctx.from.id);
    const loc = ctx.message.text.trim();

    await pool.query(
      `update users
       set location=$1, updated_at=now()
       where telegram_id=$2`,
      [loc, ctx.from.id]
    );

    // Schedule debounced notification
    await scheduleStatusNotification(ctx.from.id);

    return ctx.reply(`📍 Lokacija postavljena: ${loc}`, mainKeyboard());
  }

  // Handle status message
  if (pendingStatus.has(ctx.from.id)) {
    pendingStatus.delete(ctx.from.id);
    const status = ctx.message.text.trim();

    if (status.length > 200) {
      return ctx.reply("⚠️ Status poruka je preduga (max 200 karaktera).", mainKeyboard());
    }

    await pool.query(
      `update users
       set status_message=$1, updated_at=now()
       where telegram_id=$2`,
      [status, ctx.from.id]
    );

    // Schedule debounced notification
    await scheduleStatusNotification(ctx.from.id);

    return ctx.reply(`💬 Status postavljen: ${status}`, mainKeyboard());
  }
});

/* ======================
   INLINE GROUP COMMANDS (added)
   Enable in BotFather: /setinline -> Enable

   Usage:
     @bot status Pijem kafu ☕
     @bot lokacija Kafana Kod Mike
     @bot show
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
      "Postavi status bez spama (ne moraš ništa slati u grupu)",
      "💬 status <tekst>",
      Markup.inlineKeyboard([[Markup.button.callback("❌ Close", "ig:close")]])
    );
    addArticle(
      "p_loc",
      "📍 lokacija <tekst>",
      "Postavi lokaciju bez spama (ne moraš ništa slati u grupu)",
      "📍 lokacija <tekst>",
      Markup.inlineKeyboard([[Markup.button.callback("❌ Close", "ig:close")]])
    );
    addArticle(
      "p_show",
      "🤡 show",
      "Ubacuje poruku sa tvojim statusom (Refresh/Close)",
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

  // status <text> -> update status_message quietly + keep existing debounce behavior
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

    // Keep existing behavior: upsert + update + schedule debounced group status
    await upsertUser(ctx.from);

    await pool.query(
      `update users
       set status_message=$1, updated_at=now()
       where telegram_id=$2`,
      [text, ctx.from.id]
    );

    await scheduleStatusNotification(ctx.from.id);

    // Optional confirmation (user can choose to send it or not)
    addArticle(
      "status_ok",
      "✅ Status sačuvan",
      "Ne moraš ništa slati u grupu.",
      "✅ Status sačuvan.",
      Markup.inlineKeyboard([[Markup.button.callback("❌ Close", "ig:close")]])
    );

    return ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });
  }

  // lokacija <text> -> update location quietly + keep existing debounce behavior
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

    await scheduleStatusNotification(ctx.from.id);

    addArticle(
      "loc_ok",
      "✅ Lokacija sačuvana",
      "Ne moraš ništa slati u grupu.",
      "📍 Lokacija sačuvana.",
      Markup.inlineKeyboard([[Markup.button.callback("❌ Close", "ig:close")]])
    );

    return ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });
  }

  // show -> allow user to insert a status message into the chat
  if (cmd === "show" || cmd === "moj" || cmd === "me") {
    addArticle(
      "showstatus",
      "🤡 Moj status",
      "Klikni da ubaciš poruku sa statusom (Refresh/Close).",
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
   INLINE CALLBACKS (added)
====================== */

bot.on("callback_query", async (ctx) => {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("ig:")) return;

  await ctx.answerCbQuery().catch(() => {});
  const cmd = data.slice(3);

  if (cmd === "close") {
    // Delete if bot has permission; else edit minimal
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
