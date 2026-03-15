const cron = require('node-cron');
const { runPipeline } = require('../pipeline/index');

let isRunning = false;

async function runScan() {
  if (isRunning) {
    console.log('[scheduler] Previous scan still running, skipping');
    return;
  }
  isRunning = true;
  try {
    await runPipeline();
  } catch (err) {
    console.error('[scheduler] Pipeline failed:', err.message);
  } finally {
    isRunning = false;
  }
}

function startScheduler() {
  const intervalMin = parseInt(process.env.SCAN_INTERVAL_MIN || '5', 10);
  console.log(`[scheduler] Scanning every ${intervalMin} minutes`);

  // Run immediately
  runScan();

  // Then on schedule
  cron.schedule(`*/${intervalMin} * * * *`, runScan);
}

module.exports = { startScheduler, runScan };
