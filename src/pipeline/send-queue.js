const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '../../data');
const SEND_FILE = path.join(DATA_DIR, 'send-queue.json');

function loadSendQueue() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  if (!fs.existsSync(SEND_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(SEND_FILE, 'utf8')); } catch { return []; }
}

function saveSendQueue(queue) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  fs.writeFileSync(SEND_FILE, JSON.stringify(queue, null, 2), 'utf8');
}

function addToSendQueue(item) {
  const queue = loadSendQueue();
  queue.push({ ...item, queuedAt: new Date().toISOString() });
  saveSendQueue(queue);
}

function takeSendNext() {
  const queue = loadSendQueue();
  if (queue.length === 0) return null;
  const item = queue.shift();
  saveSendQueue(queue);
  return item;
}

function sendQueueLength() {
  return loadSendQueue().length;
}

module.exports = { addToSendQueue, takeSendNext, sendQueueLength };
