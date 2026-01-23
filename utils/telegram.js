// utils/telegram.js
import crypto from "crypto";

export function verifyTelegramWebAppData(initData) {
  if (!initData) throw new Error("No init data");

  const BOT_TOKEN = process.env.BOT_TOKEN;
  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get("hash");
  urlParams.delete("hash");

  const dataCheckString = Array.from(urlParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (calculatedHash !== hash) {
    throw new Error("Invalid init data");
  }

  const user = JSON.parse(urlParams.get("user"));
  return user.id;
}