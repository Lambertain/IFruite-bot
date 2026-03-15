require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { Bot } = require('grammy');
const { formatApprovalCard, buildApprovalKeyboard } = require('./messages');

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

bot.catch((err) => {
  const msg = err?.error?.message || err?.message || String(err);
  if (msg.includes('409') || msg.includes('Conflict')) {
    console.error('Bot polling conflict, retrying...');
    return;
  }
  console.error('Bot error:', msg);
});

// Approval queue
const approvalQueue = [];
let currentApproval = null;
let currentMessageId = null;
const editMode = new Map();
const editMedia = new Map();
const callbacks = new Map();
const mediaBuffer = [];

// --- Send approval ---

async function sendNextApproval() {
  if (currentApproval) return;
  if (approvalQueue.length === 0) return;

  const item = approvalQueue.shift();
  currentApproval = item;

  const text = formatApprovalCard(item);
  const keyboard = buildApprovalKeyboard(item.approvalId);

  try {
    const msg = await bot.api.sendMessage(CHAT_ID, text, {
      parse_mode: 'MarkdownV2',
      reply_markup: keyboard
    });
    currentMessageId = msg.message_id;
    // Send customer photos if any
    for (const url of (item.images || []).slice(0, 5)) {
      try { await bot.api.sendPhoto(CHAT_ID, url, { caption: `📷 Фото від ${item.username}` }); } catch {}
    }
  } catch (err) {
    console.error('MarkdownV2 failed:', err.message);
    try {
      const plain = `📱 ${item.username} | Instagram\n\n💬 КЛІЄНТ:\n${item.lastMessage}\n\n✏️ ЧЕРНЕТКА:\n${item.draft}`;
      const msg = await bot.api.sendMessage(CHAT_ID, plain, { reply_markup: keyboard });
      currentMessageId = msg.message_id;
    } catch (err2) {
      console.error('Plain text failed:', err2.message);
      const cb = callbacks.get(item.approvalId);
      if (cb) { callbacks.delete(item.approvalId); cb.resolve({ action: 'skip', text: null, media: [] }); }
      currentApproval = null;
      sendNextApproval();
    }
  }
}

function queueApproval(item) {
  return new Promise((resolve) => {
    const approvalId = item.approvalId || `ig-${Date.now()}`;
    item.approvalId = approvalId;
    callbacks.set(approvalId, { resolve, item });
    approvalQueue.push(item);
    sendNextApproval();
  });
}

// --- Callbacks ---

bot.on('callback_query:data', async (ctx) => {
  const [action, ...idParts] = ctx.callbackQuery.data.split(':');
  const approvalId = idParts.join(':');

  if (!currentApproval || currentApproval.approvalId !== approvalId) {
    await ctx.answerCallbackQuery({ text: 'Цей елемент вже не активний' });
    return;
  }

  const cb = callbacks.get(approvalId);

  if (action === 'approve') {
    await ctx.answerCallbackQuery({ text: '✅ Схвалено!' });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    if (cb) { callbacks.delete(approvalId); cb.resolve({ action: 'approve', text: currentApproval.draft, media: editMedia.get(approvalId) || [] }); }
    editMedia.delete(approvalId);
    currentApproval = null;
    currentMessageId = null;
    sendNextApproval();
  } else if (action === 'edit') {
    editMode.set(approvalId, true);
    editMedia.set(approvalId, []);
    await ctx.answerCallbackQuery({ text: '✏️ Надішліть виправлений текст' });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await bot.api.sendMessage(CHAT_ID, '✏️ Надішліть виправлений текст відповіді.\nМожна прикріпити фото/файли.');
  } else if (action === 'skip') {
    await ctx.answerCallbackQuery({ text: '⏭ Пропущено' });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    if (cb) { callbacks.delete(approvalId); cb.resolve({ action: 'skip', text: null, media: [] }); }
    editMode.delete(approvalId); editMedia.delete(approvalId);
    currentApproval = null; currentMessageId = null;
    sendNextApproval();
  }
});

// --- Text handler ---

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();

  // EDIT mode
  if (currentApproval && editMode.has(currentApproval.approvalId)) {
    const approvalId = currentApproval.approvalId;
    editMode.delete(approvalId);
    const cb = callbacks.get(approvalId);
    if (cb) { callbacks.delete(approvalId); cb.resolve({ action: 'edit', text, media: editMedia.get(approvalId) || [] }); }
    editMedia.delete(approvalId);
    await ctx.reply('✅ Текст прийнято');
    currentApproval = null; currentMessageId = null;
    sendNextApproval();
    return;
  }

  // Free chat — agent mode (simple echo for now, can add AI later)
  await ctx.reply('🤖 Бот працює. Повідомлення з Instagram оброблюються автоматично.');
});

// --- Media handler ---

bot.on('message:photo', async (ctx) => { await handleMedia(ctx, 'photo'); });
bot.on('message:document', async (ctx) => { await handleMedia(ctx, 'document'); });

async function handleMedia(ctx, type) {
  if (currentApproval && editMode.has(currentApproval.approvalId)) {
    const approvalId = currentApproval.approvalId;
    const files = editMedia.get(approvalId) || [];
    let fileId = type === 'photo' ? ctx.message.photo[ctx.message.photo.length - 1].file_id : ctx.message.document.file_id;
    const file = await ctx.api.getFile(fileId);
    const downloadUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const fs = require('fs');
    const pathMod = require('path');
    const tmpDir = pathMod.resolve(__dirname, '../../data/tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const ext = pathMod.extname(file.file_path) || (type === 'photo' ? '.jpg' : '');
    const localPath = pathMod.join(tmpDir, `media-${Date.now()}${ext}`);
    const res = await fetch(downloadUrl);
    fs.writeFileSync(localPath, Buffer.from(await res.arrayBuffer()));
    files.push(localPath);
    editMedia.set(approvalId, files);
    await ctx.reply(`📎 Файл додано (${files.length}). Надішліть текст відповіді.`);
    return;
  }
  await ctx.reply(`📎 Файл отримано. Зараз немає активного повідомлення для відповіді.`);
}

// --- Lifecycle ---

async function startBot() {
  console.log('Telegram bot starting...');
  await bot.api.deleteWebhook({ drop_pending_updates: true });
  await new Promise(r => setTimeout(r, 2000));
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

module.exports = { bot, startBot, stopBot, queueApproval, sendNextApproval };
