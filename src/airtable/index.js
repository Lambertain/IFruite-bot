const API_BASE = 'https://api.airtable.com/v0';

async function airtableFetch(tableName, method = 'GET', body = null, params = '') {
  const token = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!token || !baseId) throw new Error('Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID');

  const url = `${API_BASE}/${baseId}/${encodeURIComponent(tableName)}${params}`;
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function searchProducts(query) {
  // Fetch all iPhones (or filter by model)
  const filter = query
    ? `?filterByFormula=SEARCH(LOWER("${query.replace(/"/g, '\\"')}"), LOWER({Model}))`
    : '';
  const data = await airtableFetch('iPhones', 'GET', null, filter || '?maxRecords=50');
  return (data.records || []).map(r => ({
    id: r.id,
    model: r.fields['Model'] || '',
    source: r.fields['Source'] || '',
    imei: r.fields['IMEI / SN'] || '',
    quantity: r.fields['Quantity'] || 0,
    priceUSD: r.fields['Retail USD'] || 0,
    priceUAH: r.fields['Retail UAH'] || 0,
    battery: r.fields['Battery %'] || null,
    condition: r.fields['Condition'] || '',
    notes: r.fields['Notes'] || '',
    photos: (r.fields['Photos'] || []).map(p => p.url),
    listedOn: r.fields['Listed On'] || '',
    agent: r.fields['Sales Agent'] || ''
  }));
}

async function getExchangeRate() {
  const data = await airtableFetch('Exchange Rates', 'GET', null, '?maxRecords=1&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc');
  const rec = data.records?.[0];
  return rec ? { rate: rec.fields['USD to UAH Rate'], date: rec.fields['Date'] } : null;
}

module.exports = { searchProducts, getExchangeRate };
