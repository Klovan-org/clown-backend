import { Telegraf, Markup } from "telegraf";
import { pool } from "./db.js";

export const bot = new Telegraf(process.env.BOT_TOKEN);

/* ======================
   HELPERS
====================== */

const MAX_LEVEL = 6;

function mainKeyboard() {
  return Markup.keyboard([
    ["🤡 Moj status", "🎚️ Level +1"],
    ["📍 Lokacija", "💬 Status poruka"],
    ["📊 Dashboard"],
  ]).resize();
}

async function isMember(telegramId) {
  const r = await pool.query(
    `select 1 from users where telegram_id=$1`,
    [telegramId]
  );
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
  await pool.query(
    `update invites set uses=uses+1 where code=$1`,
    [payload]
  );

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
    Markup.inlineKeyboard([
      Markup.button.webApp("📊 Dashboard", url),
    ])
  );
});

/* ======================
   LEVEL +1
====================== */

bot.hears("🎚️ Level +1", async (ctx) => {
  await upsertUser(ctx.from);
  
  // Proveri trenutni level
  const current = await pool.query(
    `select level from users where telegram_id=$1`,
    [ctx.from.id]
  );
  
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

    return ctx.reply(`💬 Status postavljen: ${status}`, mainKeyboard());
  }
});