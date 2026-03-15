const fs = require('fs');
const path = require('path');

const API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

const INFO_DIR = path.resolve(__dirname, '../info');

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

Відповідай ТІЛЬКИ текст повідомлення для клієнта, без пояснень.`;
}

async function generateReply(messages, inventory, exchangeRate) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

  const systemPrompt = buildSystemPrompt(inventory, exchangeRate);

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
        { role: 'user', content: `Діалог:\n${history}\n\nНапиши відповідь клієнту:` }
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
