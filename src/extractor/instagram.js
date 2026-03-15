async function extractUnreadDMs(page) {
  await page.goto('https://www.instagram.com/direct/inbox/', { waitUntil: 'load', timeout: 30000 });
  await new Promise(r => setTimeout(r, 8000));

  // Click General tab (that's where customer messages go)
  try {
    const generalTab = page.locator('span:text-is("General")');
    if (await generalTab.count() > 0) {
      await generalTab.first().click();
      await new Promise(r => setTimeout(r, 3000));
    }
  } catch {}

  // Instagram renders conversations as div rows with innerText containing:
  // "Username\nPreview text\n · time"
  // We parse body text to find conversations
  const conversations = await page.evaluate(() => {
    const body = document.body.innerText;
    const lines = body.split('\n').map(l => l.trim()).filter(Boolean);

    // Find conversation entries: name followed by preview with timestamp
    const convs = [];
    for (let i = 0; i < lines.length; i++) {
      // Skip UI elements
      if (['Primary', 'General', 'Requests', 'Search', 'Your note', 'Send message', 'Your messages'].some(s => lines[i] === s)) continue;
      if (lines[i].startsWith('Start your')) continue;
      if (lines[i].includes('ifruite_macbook_laptop')) continue;

      // Instagram format:
      // "Username"
      // "Preview text"
      // " "  (or empty)
      // "· Xm/Xh/Xd/Xw"
      // (optional) "Unread"
      //
      // OR compact: "Preview · Xm"

      // Look ahead for time indicator within next 3 lines
      let timeAgo = null;
      let previewLine = null;
      for (let j = 1; j <= 3 && i + j < lines.length; j++) {
        const tm = lines[i + j].match(/^·\s*(\d+[wdhm]|Just now)/);
        if (tm) { timeAgo = tm[1]; break; }
        const tm2 = lines[i + j].match(/·\s*(\d+[wdhm]|Just now)/);
        if (tm2) { timeAgo = tm2[1]; previewLine = lines[i + j].replace(/\s*·\s*\d+[wdhm].*$/, '').trim(); break; }
      }

      if (timeAgo) {
        const username = lines[i];
        const preview = previewLine || (lines[i + 1] && !lines[i + 1].startsWith('·') ? lines[i + 1] : '');
        const isOurs = preview.startsWith('You:');
        convs.push({
          username,
          preview: isOurs ? preview.slice(4).trim() : preview,
          isOurs,
          timeAgo
        });
      }
    }
    return convs;
  });

  // Filter: only conversations where last message is NOT ours
  const unread = conversations.filter(c => !c.isOurs);
  return unread;
}

async function openConversation(page, username) {
  // Click on conversation by username text
  const conv = page.locator(`span:text-is("${username}")`).first();
  if (await conv.count() === 0) return false;
  await conv.click();
  await new Promise(r => setTimeout(r, 4000));
  return true;
}

async function extractConversation(page, username) {
  const opened = await openConversation(page, username);
  if (!opened) return { username, messages: [], images: [] };

  const dialog = await page.evaluate((myAccount) => {
    const body = document.body.innerText;
    const url = location.href;

    // Instagram chat messages are in the right panel
    // Messages from us start with our account name or are right-aligned
    // For now parse from body text — find the message area
    const lines = body.split('\n').map(l => l.trim()).filter(Boolean);

    // Find where chat messages start (after username header)
    const messages = [];
    let inChat = false;
    let currentSender = null;

    for (const line of lines) {
      // Skip common UI text
      if (['Primary', 'General', 'Requests', 'Search', 'Your note', 'Send message',
           'Your messages', 'Start your first note...', 'Message...', 'Audio',
           'Like', 'Send'].includes(line)) continue;

      // Sender indicators
      if (line === myAccount || line === 'You') {
        currentSender = 'self';
        continue;
      }

      // Time stamps like "7:35 PM", "Yesterday 3:00 PM"
      if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(line)) continue;
      if (/^(Yesterday|Today|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i.test(line) && /\d{1,2}:\d{2}/.test(line)) continue;

      // Skip very short lines that are likely UI
      if (line.length < 2) continue;

      // This is a message
      if (line.length > 2 && !line.startsWith('·')) {
        messages.push({
          role: currentSender || 'customer',
          text: line
        });
        currentSender = null; // reset after consuming
      }
    }

    // Get images
    const images = [...document.querySelectorAll('img[src*="instagram"]')]
      .map(img => img.src)
      .filter(src => !src.includes('profile') && !src.includes('avatar') && !src.includes('static'))
      .slice(0, 10);

    return { url, username, messages, images };
  }, 'ifruite_macbook_laptop');

  return dialog;
}

async function sendReply(page, username, message) {
  const opened = await openConversation(page, username);
  if (!opened) throw new Error(`Could not open conversation with ${username}`);

  // Find message input
  const input = page.locator('[contenteditable="true"][role="textbox"], textarea[placeholder*="Message"]').first();
  await input.click();
  await page.keyboard.type(message, { delay: 20 });
  await new Promise(r => setTimeout(r, 500));

  // Press Enter to send
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 2000));

  return { ok: true };
}

module.exports = { extractUnreadDMs, extractConversation, sendReply };
