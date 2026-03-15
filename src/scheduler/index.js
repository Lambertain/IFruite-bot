const { openPage } = require('../extractor/adspower');
const { extractUnreadDMs, extractConversation, sendReply } = require('../extractor/instagram');
const { generateReply } = require('../ai/openai');
const { searchProducts, getExchangeRate } = require('../airtable/index');
const { addToQueue } = require('../pipeline/queue');
const { takeSendNext, sendQueueLength } = require('../pipeline/send-queue');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '../../data');
const PROCESSED_FILE = path.join(DATA_DIR, 'processed', 'processed-ids.json');
const DEBOUNCE_FILE = path.join(DATA_DIR, 'debounce.json');

// Persistent browser session
let session = null;

function loadProcessedIds() {
  if (!fs.existsSync(PROCESSED_FILE)) return new Set();
  try { return new Set(JSON.parse(fs.readFileSync(PROCESSED_FILE, 'utf8'))); } catch { return new Set(); }
}

function saveProcessedIds(ids) {
  fs.mkdirSync(path.dirname(PROCESSED_FILE), { recursive: true });
  fs.writeFileSync(PROCESSED_FILE, JSON.stringify([...ids], null, 2), 'utf8');
}

// Debounce: track last message count per conversation
function loadDebounce() {
  if (!fs.existsSync(DEBOUNCE_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(DEBOUNCE_FILE, 'utf8')); } catch { return {}; }
}

function saveDebounce(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DEBOUNCE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function extractProductQuery(messages) {
  const recent = messages.filter(m => m.role === 'customer').map(m => m.text).join(' ').toLowerCase();
  const iPhoneMatch = recent.match(/iphone\s*(\d{1,2})\s*(pro\s*max|pro|plus|mini)?/i);
  if (iPhoneMatch) return `iPhone ${iPhoneMatch[1]}${iPhoneMatch[2] ? ' ' + iPhoneMatch[2] : ''}`.trim();
  if (/macbook/i.test(recent)) return 'MacBook';
  if (/ipad/i.test(recent)) return 'iPad';
  if (/airpods/i.test(recent)) return 'AirPods';
  if (/apple\s*watch/i.test(recent)) return 'Apple Watch';
  return '';
}

async function ensureSession() {
  if (session) {
    // Check if browser is still alive
    try {
      await session.page.evaluate(() => true);
      return session;
    } catch {
      console.log('[scheduler] Session dead, reconnecting...');
      session = null;
    }
  }

  const profileId = process.env.ADSPOWER_PROFILE_ID;
  if (!profileId) throw new Error('Missing ADSPOWER_PROFILE_ID');
  session = await openPage(profileId);
  // Don't auto-close — we keep it alive
  const origClose = session.close;
  session.keepAlive = true;
  console.log('[scheduler] Browser session opened');
  return session;
}

async function runScan() {
  let sess;
  try {
    sess = await ensureSession();
  } catch (err) {
    console.error('[scheduler] AdsPower failed:', err.message);
    session = null;
    return;
  }

  try {
    // First: send any pending replies from approval queue
    while (sendQueueLength() > 0) {
      const toSend = takeSendNext();
      if (!toSend) break;
      try {
        await sendReply(sess.page, toSend.username, toSend.text);
        console.log(`[scheduler] ✅ Sent reply to ${toSend.username}`);
        // Navigate back to inbox for next scan
        await sess.page.goto('https://www.instagram.com/direct/inbox/', { waitUntil: 'load', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));
      } catch (err) {
        console.error(`[scheduler] Send failed for ${toSend.username}: ${err.message}`);
      }
    }

    const conversations = await extractUnreadDMs(sess.page);
    console.log(`[scheduler] Found ${conversations.length} unread conversations`);
    for (const c of conversations) console.log(`  - ${c.username}: "${c.preview}" (${c.timeAgo})`);
    const processedIds = loadProcessedIds();
    const debounce = loadDebounce();
    let newFound = 0;

    for (const conv of conversations) {
      if (processedIds.has(conv.username)) continue;

      // Extract conversation to count messages
      let dialog;
      try {
        dialog = await extractConversation(sess.page, conv.username);
      } catch (err) {
        console.error(`[scheduler] Extract error ${conv.username}: ${err.message}`);
        continue;
      }

      if (!dialog.messages || dialog.messages.length === 0) continue;

      const lastMsg = dialog.messages[dialog.messages.length - 1];
      if (lastMsg.role === 'self') {
        processedIds.add(conv.username);
        saveProcessedIds(processedIds);
        continue;
      }

      const customerMsgCount = dialog.messages.filter(m => m.role === 'customer').length;
      const key = conv.username;

      // Debounce: check if customer is still typing
      if (!debounce[key]) {
        // First time seeing new messages — start debounce
        debounce[key] = { count: customerMsgCount, firstSeen: Date.now(), lastCheck: Date.now() };
        saveDebounce(debounce);
        console.log(`[scheduler] New messages from ${conv.username} (${customerMsgCount} msgs) — waiting...`);
        continue;
      }

      const prev = debounce[key];
      if (customerMsgCount > prev.count) {
        // Customer sent more messages — reset debounce timer
        prev.count = customerMsgCount;
        prev.lastCheck = Date.now();
        saveDebounce(debounce);

        const waitedMin = Math.round((Date.now() - prev.firstSeen) / 60000);
        if (waitedMin < 3) {
          console.log(`[scheduler] ${conv.username} still typing (${customerMsgCount} msgs, ${waitedMin}min) — waiting...`);
          continue;
        }
        // Max 3 min wait — proceed
        console.log(`[scheduler] ${conv.username} max wait reached — processing`);
      }

      const sinceLastCheck = Date.now() - prev.lastCheck;
      if (sinceLastCheck < 60000) {
        // Less than 1 min since last check — wait more
        continue;
      }

      // Customer stopped typing — process
      console.log(`[scheduler] Processing: ${conv.username} (${customerMsgCount} msgs)`);
      delete debounce[key];
      saveDebounce(debounce);

      try {
        const lastCustomerMsg = [...dialog.messages].reverse().find(m => m.role === 'customer');

        // Search Airtable
        const query = extractProductQuery(dialog.messages);
        const [inventory, exchangeRate] = await Promise.all([
          searchProducts(query),
          getExchangeRate()
        ]);

        // Optimize context: only last 5 messages + summary
        const recentMessages = dialog.messages.slice(-5);

        const draft = await generateReply(recentMessages, inventory, exchangeRate);

        addToQueue({
          username: dialog.username || conv.username,
          href: conv.username,
          messages: recentMessages,
          lastMessage: lastCustomerMsg?.text || '',
          draft,
          images: dialog.images || []
        });

        processedIds.add(conv.username);
        saveProcessedIds(processedIds);
        newFound++;
      } catch (err) {
        console.error(`[scheduler] Process error ${conv.username}: ${err.message}`);
      }
    }

    if (newFound > 0) console.log(`[scheduler] ${newFound} new items queued`);
  } catch (err) {
    console.error('[scheduler] Scan error:', err.message);
    // If page crashed, reset session
    if (err.message.includes('Target closed') || err.message.includes('Session closed')) {
      session = null;
    }
  }
}

let isRunning = false;

function isWorkingHours() {
  // Temporarily disabled for testing
  return true;
}

function startScheduler() {
  console.log('[scheduler] Scanning every 1 min, 8:00-22:00 Kyiv (debounce: 1-3 min)');

  // Run immediately if working hours
  if (isWorkingHours()) {
    (async () => {
      isRunning = true;
      try { await runScan(); } catch {} finally { isRunning = false; }
    })();
  }

  // Then every minute
  setInterval(async () => {
    if (isRunning) return;
    if (!isWorkingHours()) return;
    isRunning = true;
    try { await runScan(); } catch (err) {
      console.error('[scheduler] Error:', err.message);
    } finally { isRunning = false; }
  }, 60000);
}

module.exports = { startScheduler, runScan };
