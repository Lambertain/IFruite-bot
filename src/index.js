require('dotenv').config();
const { startBot } = require('./bot/index');
const { startScheduler } = require('./scheduler/index');

async function main() {
  console.log('=== iFruite Bot starting ===');

  const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'OPENAI_API_KEY', 'ADSPOWER_API_KEY', 'ADSPOWER_PROFILE_ID'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  await startBot();
  startScheduler();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
