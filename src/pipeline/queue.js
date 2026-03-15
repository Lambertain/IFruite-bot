const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '../../data');
const QUEUE_FILE = path.join(DATA_DIR, 'approval-queue.json');

function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (err) {
    console.error('[queue] Failed to create data dir:', err.message);
  }
}

function loadQueue() {
  ensureDataDir();
  if (!fs.existsSync(QUEUE_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); } catch { return []; }
}

function saveQueue(queue) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf8');
}

function addToQueue(item) {
  const queue = loadQueue();
  // Avoid duplicates
  const id = `${item.site}::${item.photographer}::${item.url}`;
  if (queue.some(q => `${q.site}::${q.photographer}::${q.url}` === id)) return false;
  item.queuedAt = new Date().toISOString();
  queue.push(item);
  saveQueue(queue);
  return true;
}

function takeNext() {
  const queue = loadQueue();
  if (queue.length === 0) return null;
  const item = queue.shift();
  saveQueue(queue);
  return item;
}

function queueLength() {
  return loadQueue().length;
}

module.exports = { addToQueue, takeNext, queueLength, loadQueue };
