const SKIP_LINES = new Set([
  'Primary', 'General', 'Requests', 'Search', 'Your note', 'Send message',
  'Your messages', 'Send a message to start a chat.', 'Unread', 'Message...',
  'Start your first note...', 'Audio', 'Like', 'Send', '·', ''
]);

async function extractUnreadDMs(page) {
  await page.goto('https://www.instagram.com/direct/inbox/', { waitUntil: 'load', timeout: 30000 });
  await new Promise(r => setTimeout(r, 8000));

  // Click General tab
  try {
    const gen = page.locator('span:text-is("General")');
    if (await gen.count() > 0) {
      await gen.first().click();
      await new Promise(r => setTimeout(r, 4000));
    }
  } catch {}

  const conversations = await page.evaluate((skipSet) => {
    const body = document.body.innerText;
    const lines = body.split('\n').map(l => l.trim());
    const skip = new Set(skipSet);
    const convs = [];

    // Pattern: find lines that are "·" followed by time like "10m", "1w" etc
    // The username is 2-3 lines BEFORE "·", preview is between username and "·"
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] !== '·') continue;
      if (i + 1 >= lines.length) continue;

      // Next line should be time
      const timeLine = lines[i + 1];
      if (!/^\d+[wdhm]$/.test(timeLine) && timeLine !== 'Just now') continue;

      // Walk backwards to find username and preview
      // Format: username, preview, " ", "·", "10m"
      // So "·" is at i, " " at i-1, preview at i-2, username at i-3
      // OR: username, preview, "·", "10m" (no space)
      let username = null;
      let preview = '';

      if (i >= 3 && lines[i - 1].trim() === '') {
        preview = lines[i - 2];
        username = lines[i - 3];
      } else if (i >= 2) {
        preview = lines[i - 1];
        username = lines[i - 2];
      }

      if (!username || skip.has(username)) continue;
      if (/^\d+[wdhm]$/.test(username)) continue; // time, not username
      if (username.startsWith('You:')) continue; // Our message line used as username
      if (username === '·') continue;

      const isOurs = preview.startsWith('You:');
      convs.push({
        username,
        preview: isOurs ? preview.slice(4).trim() : preview,
        isOurs,
        timeAgo: timeLine
      });
    }

    return convs;
  }, [...SKIP_LINES]);

  // Filter: only where last message is NOT ours
  return conversations.filter(c => !c.isOurs);
}

async function openConversation(page, username) {
  const conv = page.locator(`span:text-is("${username}")`).first();
  if (await conv.count() === 0) return false;
  await conv.click();
  await new Promise(r => setTimeout(r, 4000));
  return true;
}

async function extractConversation(page, targetUsername) {
  const opened = await openConversation(page, targetUsername);
  if (!opened) return { username: targetUsername, messages: [], images: [] };

  const dialog = await page.evaluate((uname) => {
    const url = location.href;
    const body = document.body.innerText;
    const lines = body.split('\n').map(l => l.trim()).filter(l => l && l !== '·');

    // Find chat area — after the conversation list, messages appear
    // Simple approach: collect lines that look like messages from the right panel
    const messages = [];

    // Find textbox area as end marker
    const msgInput = document.querySelector('[contenteditable="true"][role="textbox"]');
    if (!msgInput) return { url, username: uname, messages: [], images: [] };

    // Get all text nodes in the message area (right panel)
    const rightPanel = msgInput.closest('section') || msgInput.parentElement?.parentElement?.parentElement;
    if (!rightPanel) return { url, username: uname, messages: [], images: [] };

    const panelText = (rightPanel.innerText || '').split('\n').map(l => l.trim()).filter(Boolean);

    // Parse messages — we can't easily determine sender from text alone
    // But we know our account name
    for (const line of panelText) {
      if (line.length < 2) continue;
      if (['Message...', 'Audio', 'Like', 'Send', 'GIF', 'Stickers'].includes(line)) continue;
      if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(line)) continue;
      if (/^(Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i.test(line)) continue;

      messages.push({ role: 'customer', text: line });
    }

    const images = [];
    return { url, username: uname, messages, images };
  }, targetUsername);

  return dialog;
}

async function sendReply(page, targetUsername, message) {
  const opened = await openConversation(page, targetUsername);
  if (!opened) throw new Error('Could not open conversation with ' + targetUsername);

  const input = page.locator('[contenteditable="true"][role="textbox"]').first();
  await input.click();
  await page.keyboard.type(message, { delay: 20 });
  await new Promise(r => setTimeout(r, 500));
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 2000));

  return { ok: true };
}

module.exports = { extractUnreadDMs, extractConversation, sendReply };
