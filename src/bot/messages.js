function formatApprovalCard(item) {
  const lines = [
    `📱 *${escapeMarkdown(item.username || 'Unknown')}*`,
    `🌐 Instagram Direct`,
    '',
    '💬 *Повідомлення клієнта:*',
    escapeMarkdown(truncate(item.lastMessage, 500)),
    '',
    '✏️ *Чернетка відповіді:*',
    escapeMarkdown(truncate(item.draft, 800))
  ];
  return lines.join('\n');
}

function buildApprovalKeyboard(approvalId) {
  return {
    inline_keyboard: [[
      { text: '✅ OK', callback_data: `approve:${approvalId}` },
      { text: '✏️ EDIT', callback_data: `edit:${approvalId}` },
      { text: '⏭ SKIP', callback_data: `skip:${approvalId}` }
    ]]
  };
}

function escapeMarkdown(text) {
  return (text || '').replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function truncate(text, max) {
  if (!text) return '(порожньо)';
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}

module.exports = { formatApprovalCard, buildApprovalKeyboard, escapeMarkdown };
