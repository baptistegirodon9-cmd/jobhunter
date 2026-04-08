'use strict';

const cron               = require('node-cron');
const { runAllScrapers } = require('./scrapers');

/**
 * Starts the background scheduler.
 * Default: runs a full refresh every 6 hours.
 * Override with CRON_SCHEDULE env var (standard cron syntax).
 */
function startScheduler() {
  const schedule = process.env.CRON_SCHEDULE ?? '0 * * * *'; // every hour

  if (!cron.validate(schedule)) {
    console.error(`[scheduler] Invalid CRON_SCHEDULE "${schedule}" — scheduler disabled.`);
    return;
  }

  cron.schedule(schedule, async () => {
    console.log('[scheduler] Triggered scheduled refresh.');
    try {
      await runAllScrapers();
    } catch (err) {
      console.error('[scheduler] Unhandled error during refresh:', err.message);
    }
  });

  console.log(`[scheduler] Refresh scheduled: "${schedule}" (every hour).`);
}

module.exports = { startScheduler };
