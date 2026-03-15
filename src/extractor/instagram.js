async function extractUnreadDMs(page) {
  // Navigate to Instagram DMs
  await page.goto('https://www.instagram.com/direct/inbox/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  // Get list of conversations with unread messages
  const conversations = await page.evaluate(() => {
    // Instagram DM inbox — find conversation items with unread indicators
    const items = [...document.querySelectorAll('[role="listbox"] [role="option"], [role="list"] a[href*="/direct/t/"]')];
    return items.slice(0, 20).map(item => {
      const link = item.closest('a') || item.querySelector('a');
      const href = link?.href || '';
      const text = (item.innerText || '').trim();
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      // Check for unread indicator (blue dot, bold text, etc)
      const hasUnread = item.querySelector('[data-visualcompletion="css-img"]') !== null ||
        item.querySelector('span[style*="font-weight: 600"]') !== null ||
        item.classList.contains('_ab8w') ||
        (item.getAttribute('aria-selected') === 'false' && lines.length > 0);
      return {
        href,
        username: lines[0] || '',
        preview: lines.slice(1).join(' ').slice(0, 200),
        hasUnread
      };
    }).filter(x => x.href);
  });

  return conversations;
}

async function extractConversation(page, href) {
  await page.goto(href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  const dialog = await page.evaluate(() => {
    const url = location.href;
    // Extract username from conversation header
    const header = document.querySelector('header') || document.querySelector('[role="banner"]');
    const username = (header?.querySelector('span')?.textContent || '').trim();

    // Extract messages
    const msgElements = [...document.querySelectorAll('[role="row"], [class*="message"]')];
    const messages = msgElements.map(el => {
      const text = (el.innerText || '').trim();
      if (!text) return null;
      // Determine if sent by us or by them — Instagram uses different alignment/styling
      const isSelf = el.querySelector('[class*="self"]') !== null ||
        el.closest('[style*="flex-end"]') !== null ||
        el.querySelector('[data-testid="outgoing"]') !== null;
      // Simpler heuristic: messages on the right are ours
      const rect = el.getBoundingClientRect();
      const parentRect = el.parentElement?.getBoundingClientRect();
      const isRight = parentRect && (rect.left - parentRect.left) > (parentRect.width / 3);
      return { role: isRight || isSelf ? 'self' : 'customer', text };
    }).filter(Boolean);

    // Get images in messages
    const images = [...document.querySelectorAll('[role="row"] img, [class*="message"] img')]
      .map(img => img.src)
      .filter(src => src && !src.includes('profile') && !src.includes('avatar'));

    return { url, username, messages, images };
  });

  return dialog;
}

async function sendReply(page, href, message) {
  await page.goto(href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Find message input
  const input = page.locator('[role="textbox"][contenteditable="true"], textarea[placeholder*="Message"], [aria-label*="Message"]').first();
  await input.click();
  await input.fill(message);
  await page.waitForTimeout(500);

  // Press Enter to send
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);

  return { ok: true };
}

module.exports = { extractUnreadDMs, extractConversation, sendReply };
