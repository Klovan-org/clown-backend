import { Telegraf, Markup } from "telegraf";
import { pool } from "./db.js";

export const bot = new Telegraf(process.env.BOT_TOKEN);

/* ======================
   HELPERS
====================== */

function mainKeyboard() {
  return Markup.keyboard([
    ["🎚️ Level +1", "🎚️ Level -1"],
    ["📍 Lokacija"],
    ["🧾 Moj status", "📊 Dashboard"],
    ["➕ Invite"],
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
   INVITE (SVI ČLANOVI)
====================== */

bot.hears("➕ Invite", async (ctx) => {
  if (!(await isMember(ctx.from.id))) {
    return ctx.reply("⛔ Moraš prvo biti član.");
  }

  const code = "INV_" + Math.random().toString(36).slice(2, 10);

  await pool.query(
    `insert into invites (code) values ($1)`,
    [code]
  );

  const botUsername = process.env.BOT_USERNAME;
  if (!botUsername) {
    return ctx.reply("⚠️ BOT_USERNAME nije podešen.");
  }

  const link = `https://t.me/${botUsername}?start=${code}`;

  return ctx.reply(
    `➕ Invite napravljen:\n${link}`,
    mainKeyboard()
  );
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
   LEVEL + / -
====================== */

bot.hears("🎚️ Level +1", async (ctx) => {
  await upsertUser(ctx.from);
  const r = await pool.query(
    `update users
     set level=coalesce(level,0)+1, updated_at=now()
     where telegram_id=$1
     returning level`,
    [ctx.from.id]
  );
  return ctx.reply(`✅ Level: ${r.rows[0].level}`, mainKeyboard());
});

bot.hears("🎚️ Level -1", async (ctx) => {
  await upsertUser(ctx.from);
  const r = await pool.query(
    `update users
     set level=greatest(coalesce(level,0)-1,0), updated_at=now()
     where telegram_id=$1
     returning level`,
    [ctx.from.id]
  );
  return ctx.reply(`✅ Level: ${r.rows[0].level}`, mainKeyboard());
});

/* ======================
   STATUS
====================== */

bot.hears("🧾 Moj status", async (ctx) => {
  const r = await pool.query(
    `select level, location, updated_at
     from users where telegram_id=$1`,
    [ctx.from.id]
  );

  const u = r.rows[0];
  if (!u) return ctx.reply("Nisi u bazi.");

  return ctx.reply(
    `🤡 Level: ${u.level ?? 0}\n📍 Lokacija: ${u.location || "—"}\n🕒 ${u.updated_at}`,
    mainKeyboard()
  );
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
  return ctx.reply("Otkazano.", mainKeyboard());
});

bot.on("text", async (ctx) => {
  if (!pendingLocation.has(ctx.from.id)) return;

  pendingLocation.delete(ctx.from.id);
  const loc = ctx.message.text.trim();

  await pool.query(
    `update users
     set location=$1, updated_at=now()
     where telegram_id=$2`,
    [loc, ctx.from.id]
  );

  return ctx.reply(`📍 Lokacija postavljena: ${loc}`, mainKeyboard());
});
