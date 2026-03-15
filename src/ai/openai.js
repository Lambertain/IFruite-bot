const fs = require('fs');
const path = require('path');

const API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

const INFO_DIR = path.resolve(__dirname, '../info');
const DATA_DIR = path.resolve(__dirname, '../../data');
const TRAINING_LOG = path.join(DATA_DIR, 'training', 'approved-responses.jsonl');
const MAX_EXAMPLES = 5;

function loadShopInfo() {
  const files = ['instagram_style_responses.md', 'product_categories.md', 'service_information.md', 'warranty_packages.md'];
  return files
    .map(f => {
      const fp = path.join(INFO_DIR, f);
      return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
    })
    .filter(Boolean)
    .join('\n\n---\n\n');
}

function loadAllEntries() {
  if (!fs.existsSync(TRAINING_LOG)) return [];
  try {
    return fs.readFileSync(TRAINING_LOG, 'utf8').trim().split('\n')
      .filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

function loadTrainingExamples() {
  const entries = loadAllEntries();
  const examples = entries.filter(e => e.action === 'edit').slice(-MAX_EXAMPLES);
  if (examples.length === 0) return '';
  const text = examples.map((e, i) =>
    `Приклад ${i + 1}:\nКлієнт: ${e.lastMessage}\nВідповідь: ${e.finalText}`
  ).join('\n\n');
  return `ПРИКЛАДИ КОРЕКЦІЙ МЕНЕДЖЕРА (вчися зі стилю):\n${text}`;
}

function findCachedResponse(customerMessage) {
  const entries = loadAllEntries();
  if (entries.length === 0) return null;

  const normalized = customerMessage.toLowerCase().trim().replace(/[?!.,]+/g, '');

  // Search approved responses for similar questions
  for (const e of entries.reverse()) {
    if (e.action !== 'approve' && e.action !== 'edit') continue;
    const entryNorm = (e.lastMessage || '').toLowerCase().trim().replace(/[?!.,]+/g, '');
    if (!entryNorm) continue;

    // Exact or near-exact match
    if (entryNorm === normalized) return { text: e.finalText, exact: true };

    // Both ask about same iPhone model
    const modelA = normalized.match(/iphone\s*\d{1,2}\s*(pro\s*max|pro|plus|mini)?/i);
    const modelB = entryNorm.match(/iphone\s*\d{1,2}\s*(pro\s*max|pro|plus|mini)?/i);
    if (modelA && modelB && modelA[0].toLowerCase() === modelB[0].toLowerCase()) {
      // Same model query but DON'T return cached — prices may have changed
      // Instead return as template hint
      return { template: e.finalText, model: modelA[0], exact: false };
    }
  }
  return null;
}

function buildSystemPrompt(inventory, exchangeRate) {
  const shopInfo = loadShopInfo();
  const rateInfo = exchangeRate ? `Поточний курс: $1 = ${exchangeRate.rate} грн (${exchangeRate.date})` : '';

  const stockInfo = inventory.length > 0
    ? inventory.map(p => {
        const parts = [`${p.model} — ${p.condition}`];
        if (p.priceUSD) parts.push(`$${p.priceUSD}`);
        if (p.priceUAH) parts.push(`${p.priceUAH} грн`);
        if (p.battery) parts.push(`батарея ${p.battery}%`);
        if (p.quantity > 1) parts.push(`кількість: ${p.quantity}`);
        if (p.notes) parts.push(p.notes);
        return parts.join(', ');
      }).join('\n')
    : 'Немає товарів у наявності за цим запитом';

  return `Ти — продавець-консультант магазину Apple техніки iFruite. Відповідаєш в Instagram Direct.

ПРАВИЛА:
- Відповідай ТІЛЬКИ українською мовою
- Використовуй стиль з інструкцій нижче — дружній, з емодзі, але професійний
- Давай конкретні ціни та наявність з каталогу
- Якщо товару немає — запропонуй альтернативу або скажи що можеш замовити
- НЕ вигадуй ціни — бери тільки з каталогу
- Якщо питають про ремонт/сервіс — давай інфо з сервісного прайсу
- Якщо питають про гарантію — розкажи про пакети
- Будь коротким (2-5 речень), не пиши есе
- Підписуйся як магазин, не як конкретна людина

ІНФОРМАЦІЯ ПРО МАГАЗИН:
${shopInfo}

${rateInfo}

НАЯВНІСТЬ ТОВАРІВ:
${stockInfo}

Відповідай ТІЛЬКИ текст повідомлення для клієнта, без пояснень.

${loadTrainingExamples()}`;
}

async function generateReply(messages, inventory, exchangeRate) {
  const lastCustomer = [...messages].reverse().find(m => m.role === 'customer');
  const lastText = lastCustomer?.text || '';

  // Check cache first — exact match = reuse style template with fresh data
  const cached = findCachedResponse(lastText);
  if (cached?.exact && !lastText.match(/ціна|скільки|коштує|price/i)) {
    // Non-price exact match — safe to reuse as-is
    console.log('[ai] Cache hit (exact):', lastText.slice(0, 50));
    return cached.text;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

  const systemPrompt = buildSystemPrompt(inventory, exchangeRate);

  // If we have a style template from cache, hint AI to follow it
  const styleHint = cached?.template
    ? `\n\nШАБЛОН СТИЛЮ (раніше менеджер відповідав на схоже питання так):\n${cached.template}\nВикористай цей стиль але з актуальними даними.`
    : '';

  const history = messages
    .map(m => `[${m.role === 'self' ? 'МАГАЗИН' : 'КЛІЄНТ'}]: ${m.text}`)
    .join('\n');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Діалог:\n${history}${styleHint}\n\nНапиши відповідь клієнту:` }
      ],
      temperature: 0.7,
      max_tokens: 500
    })
  });

  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

module.exports = { generateReply };
