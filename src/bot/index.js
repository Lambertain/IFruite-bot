require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const { Bot } = require('grammy');
const { formatApprovalCard, buildApprovalKeyboard } = require('./messages');
const { chat: agentChat } = require('../ai/agent');
const { takeNext, queueLength } = require('../pipeline/queue');
const { addToSendQueue } = require('../pipeline/send-queue');

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const DATA_DIR = path.resolve(__dirname, '../../data');

bot.catch((err) => {
  const msg = err?.error?.message || err?.message || String(err);
  if (msg.includes('409') || msg.includes('Conflict')) return;
  console.error('Bot error:', msg);
});

// --- Approval state: ONE at a time ---
let currentApproval = null;
let waitingForEdit = false;
let queueLock = false;

// --- Queue processor: check every 10s ---
function startQueueProcessor() {
  setInterval(async () => {
    if (currentApproval || queueLock) return;
    const len = queueLength();
    if (len === 0) return;

    queueLock = true;
    const item = takeNext();
    if (!item) { queueLock = false; return; }

    currentApproval = item;
    currentApproval.approvalId = `ig-${Date.now()}`;
    waitingForEdit = false;
    queueLock = false;

    console.log(`[bot] Sending approval: ${item.username}. Queue: ${len - 1} remaining`);

    const text = formatApprovalCard(item);
    const keyboard = buildApprovalKeyboard(item.approvalId);

    try {
      await bot.api.sendMessage(CHAT_ID, text, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
    } catch {
      try {
        const plain = `📱 ${item.username} | Instagram\n\n💬 КЛІЄНТ:\n${item.lastMessage}\n\n✏️ ЧЕРНЕТКА:\n${item.draft}`;
        await bot.api.sendMessage(CHAT_ID, plain, { reply_markup: keyboard });
      } catch (err2) {
        console.error('Failed to send card:', err2.message);
        currentApproval = null;
      }
    }

    // Send customer photos
    for (const url of (item.images || []).slice(0, 5)) {
      try { await bot.api.sendPhoto(CHAT_ID, url, { caption: `📷 Фото від клієнта` }); } catch {}
    }
  }, 10000);
}

// --- Handle approval result ---
async function handleApprovalResult(action, text) {
  const item = currentApproval;
  if (!item) return;

  if (action === 'approve' || action === 'edit') {
    const finalText = action === 'edit' ? text : item.draft;

    // Queue for sending via scheduler's browser session
    addToSendQueue({ username: item.username, text: finalText });
    console.log(`[bot] Queued reply for ${item.username}`);

    // Log for training
    const logDir = path.join(DATA_DIR, 'training');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'approved-responses.jsonl'), JSON.stringify({
      timestamp: new Date().toISOString(),
      username: item.username, href: item.href,
      messages: item.messages, lastMessage: item.lastMessage,
      aiDraft: item.draft, finalText, action
    }) + '\n', 'utf8');

    console.log(`[bot] ${action === 'approve' ? '✅' : '✏️'} ${item.username} done`);
  } else {
    console.log(`[bot] ⏭ Skipped: ${item.username}`);
  }

  currentApproval = null;
  waitingForEdit = false;
}

// --- Callbacks ---
bot.on('callback_query:data', async (ctx) => {
  const [action, ...idParts] = ctx.callbackQuery.data.split(':');
  const approvalId = idParts.join(':');

  if (!currentApproval || currentApproval.approvalId !== approvalId) {
    await ctx.answerCallbackQuery({ text: 'Цей елемент вже не активний' });
    return;
  }

  if (action === 'approve') {
    await ctx.answerCallbackQuery({ text: '✅ Схвалено!' });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await handleApprovalResult('approve', null);
  } else if (action === 'edit') {
    waitingForEdit = true;
    await ctx.answerCallbackQuery({ text: '✏️ Надішліть виправлений текст' });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await bot.api.sendMessage(CHAT_ID, '✏️ Надішліть виправлений текст відповіді:');
  } else if (action === 'skip') {
    await ctx.answerCallbackQuery({ text: '⏭ Пропущено' });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await handleApprovalResult('skip', null);
  }
});

// --- Text handler ---
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();

  if (currentApproval && waitingForEdit) {
    waitingForEdit = false;
    await ctx.reply('✅ Текст прийнято');
    await handleApprovalResult('edit', text);
    return;
  }

  // Resume sending
  if (text.toLowerCase() === 'resume') {
    try {
      const sched = require('../scheduler/index');
      if (sched.resumeSending) sched.resumeSending();
      await ctx.reply('▶️ Відправка відновлена');
    } catch {}
    return;
  }

  // Agent chat
  try {
    await ctx.replyWithChatAction('typing');
    const reply = await agentChat(text);
    if (reply) await ctx.reply(reply);
  } catch (err) {
    console.error('[agent] Chat error:', err.message);
    await ctx.reply('⚠️ Помилка: ' + err.message);
  }
});

// --- Media ---
bot.on('message:photo', async (ctx) => {
  if (currentApproval && waitingForEdit) {
    await ctx.reply('📎 Фото отримано. Надішліть текст відповіді.');
    return;
  }
  const caption = ctx.message.caption || '';
  if (caption) {
    try {
      await ctx.replyWithChatAction('typing');
      const reply = await agentChat(`[Фото] ${caption}`);
      if (reply) await ctx.reply(reply);
    } catch {}
  }
});

// --- Lifecycle ---
async function startBot() {
  console.log('Telegram bot starting...');
  await bot.api.deleteWebhook({ drop_pending_updates: true });
  await new Promise(r => setTimeout(r, 2000));
  startQueueProcessor();
  const startPolling = () => {
    bot.start({ onStart: () => console.log('Telegram bot started'), drop_pending_updates: true })
      .catch(err => {
        if (String(err?.message || '').includes('409')) {
          console.log('Polling conflict, retrying in 5s...');
          setTimeout(startPolling, 5000);
        } else { console.error('Bot start error:', err?.message); }
      });
  };
  startPolling();
}

function stopBot() { bot.stop(); }

module.exports = { bot, startBot, stopBot };
