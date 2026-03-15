const fs = require('fs');
const path = require('path');
const { openPage } = require('../extractor/adspower');
const { extractUnreadDMs, extractConversation, sendReply } = require('../extractor/instagram');
const { generateReply } = require('../ai/openai');
const { searchProducts, getExchangeRate } = require('../airtable/index');
const { addToQueue } = require('./queue');

const DATA_DIR = path.resolve(__dirname, '../../data');
const TRAINING_MODE = true;

function getProcessedPath() {
  const dir = path.join(DATA_DIR, 'processed');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'processed-ids.json');
}

function loadProcessedIds() {
  const fp = getProcessedPath();
  if (!fs.existsSync(fp)) return new Set();
  try { return new Set(JSON.parse(fs.readFileSync(fp, 'utf8'))); } catch { return new Set(); }
}

function saveProcessedIds(ids) {
  fs.writeFileSync(getProcessedPath(), JSON.stringify([...ids], null, 2), 'utf8');
}

// Training log
function logApproved(item, finalText, action) {
  const dir = path.join(DATA_DIR, 'training');
  fs.mkdirSync(dir, { recursive: true });
  const entry = {
    timestamp: new Date().toISOString(),
    username: item.username,
    messages: item.messages,
    lastMessage: item.lastMessage,
    aiDraft: item.draft,
    finalText,
    action
  };
  fs.appendFileSync(path.join(dir, 'approved-responses.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
}

function extractProductQuery(messages) {
  // Extract what product the customer is asking about from last messages
  const recent = messages.filter(m => m.role === 'customer').map(m => m.text).join(' ').toLowerCase();

  // iPhone model patterns
  const iPhoneMatch = recent.match(/iphone\s*(\d{1,2})\s*(pro\s*max|pro|plus|mini)?/i);
  if (iPhoneMatch) {
    return `iPhone ${iPhoneMatch[1]}${iPhoneMatch[2] ? ' ' + iPhoneMatch[2] : ''}`.trim();
  }

  // Generic Apple products
  if (/macbook/i.test(recent)) return 'MacBook';
  if (/ipad/i.test(recent)) return 'iPad';
  if (/airpods/i.test(recent)) return 'AirPods';
  if (/apple\s*watch/i.test(recent)) return 'Apple Watch';

  return ''; // general query
}

async function runPipeline() {
  const profileId = process.env.ADSPOWER_PROFILE_ID;
  if (!profileId) {
    console.error('[pipeline] Missing ADSPOWER_PROFILE_ID');
    return;
  }

  console.log('[pipeline] Starting Instagram scan...');

  let session;
  try {
    session = await openPage(profileId);
  } catch (err) {
    console.error('[pipeline] AdsPower failed:', err.message);
    return;
  }

  try {
    // 1. Get unread conversations
    const conversations = await extractUnreadDMs(session.page);
    console.log(`[pipeline] Found ${conversations.length} conversations`);

    const processedIds = loadProcessedIds();

    for (const conv of conversations) {
      const convId = conv.href;
      if (processedIds.has(convId)) continue;

      try {
        // 2. Extract full conversation
        const dialog = await extractConversation(session.page, conv.href);
        if (!dialog.messages || dialog.messages.length === 0) continue;

        const lastCustomerMsg = [...dialog.messages].reverse().find(m => m.role === 'customer');
        if (!lastCustomerMsg) continue;

        // Skip if last message is ours (already replied)
        const lastMsg = dialog.messages[dialog.messages.length - 1];
        if (lastMsg.role === 'self') {
          processedIds.add(convId);
          saveProcessedIds(processedIds);
          continue;
        }

        console.log(`[pipeline] Processing: ${dialog.username || conv.username} — "${lastCustomerMsg.text.slice(0, 80)}"`);

        // 3. Search Airtable for relevant products
        const query = extractProductQuery(dialog.messages);
        const [inventory, exchangeRate] = await Promise.all([
          searchProducts(query),
          getExchangeRate()
        ]);

        console.log(`[pipeline] Found ${inventory.length} products for "${query}"`);

        // 4. Generate reply with AI
        const draft = await generateReply(dialog.messages, inventory, exchangeRate);

        // 5. Send for approval
        const item = {
          username: dialog.username || conv.username,
          href: conv.href,
          messages: dialog.messages,
          lastMessage: lastCustomerMsg.text,
          draft,
          images: dialog.images || []
        };

        // Add to approval queue (bot processes one at a time)
        const added = addToQueue(item);
        if (added) {
          console.log(`[pipeline] 📋 Queued: ${item.username}`);
        } else {
          console.log(`[pipeline] Already in queue: ${item.username}`);
        }

        processedIds.add(convId);
        saveProcessedIds(processedIds);
      } catch (err) {
        console.error(`[pipeline] Error processing ${conv.username}: ${err.message}`);
      }
    }
  } finally {
    await session.close();
  }

  console.log('[pipeline] Scan complete');
}

module.exports = { runPipeline };
