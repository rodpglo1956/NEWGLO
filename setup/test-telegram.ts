/**
 * Test Telegram connection
 * Usage: bun run setup/test-telegram.ts
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const USER_ID = process.env.TELEGRAM_USER_ID || "";

if (!BOT_TOKEN) { console.error("❌ TELEGRAM_BOT_TOKEN not set"); process.exit(1); }
if (!USER_ID) { console.error("❌ TELEGRAM_USER_ID not set"); process.exit(1); }

console.log("Testing Telegram...");

try {
  const me = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`).then(r => r.json());
  if (!me.ok) { console.error("❌ Bad token:", me.description); process.exit(1); }
  console.log(`✅ Bot: @${me.result.username}`);

  const msg = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: USER_ID, text: "✅ Ava relay connected! Ready to assist." }),
  }).then(r => r.json());

  if (!msg.ok) { console.error("❌ Send failed:", msg.description); process.exit(1); }
  console.log("✅ Test message sent! Check Telegram.");
} catch (error) {
  console.error("❌ Error:", error);
  process.exit(1);
}
