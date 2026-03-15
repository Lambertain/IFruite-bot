const fs = require('fs');
const path = require('path');
const { searchProducts, getExchangeRate } = require('../airtable/index');

const API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
const INFO_DIR = path.resolve(__dirname, '../info');

const chatHistory = [];
const MAX_HISTORY = 30;

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

async function buildSystemPrompt() {
  const shopInfo = loadShopInfo();

  let stockSummary = '';
  let rateInfo = '';
  try {
    const [products, rate] = await Promise.all([searchProducts(''), getExchangeRate()]);
    if (rate) rateInfo = `Поточний курс: $1 = ${rate.rate} грн`;
    if (products.length > 0) {
      stockSummary = products.map(p => {
        const parts = [p.model];
        if (p.condition) parts.push(p.condition);
        if (p.priceUSD) parts.push(`$${p.priceUSD}`);
        if (p.priceUAH) parts.push(`${p.priceUAH} грн`);
        if (p.battery) parts.push(`бат. ${p.battery}%`);
        if (p.quantity > 1) parts.push(`x${p.quantity}`);
        return parts.join(' | ');
      }).join('\n');
    }
  } catch (err) {
    console.error('[agent] Airtable fetch error:', err.message);
  }

  return `Ти — AI-асистент менеджера магазину Apple техніки iFruite. Спілкуєшся з менеджером в Telegram чаті.

МОВА: відповідай ТІЛЬКИ українською.

ІНФОРМАЦІЯ ПРО МАГАЗИН:
${shopInfo}

${rateInfo}

НАЯВНІСТЬ ТОВАРІВ:
${stockSummary || '(не вдалося завантажити)'}

ЩО ТИ МОЖЕШ:
1. Відповідати на питання про наявність, ціни, характеристики товарів
2. Давати поради щодо спілкування з клієнтами
3. Підказувати ціни та альтернативи
4. Інформувати про сервіс, гарантію, доставку

Будь коротким і конкретним.`;
}

async function chat(userMessage) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

  chatHistory.push({ role: 'user', content: userMessage });
  if (chatHistory.length > MAX_HISTORY) {
    chatHistory.splice(0, chatHistory.length - MAX_HISTORY);
  }

  const systemPrompt = await buildSystemPrompt();

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...chatHistory
      ],
      temperature: 0.5,
      max_tokens: 800
    })
  });

  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const reply = (data.choices?.[0]?.message?.content || '').trim();

  chatHistory.push({ role: 'assistant', content: reply });
  return reply;
}

module.exports = { chat };
