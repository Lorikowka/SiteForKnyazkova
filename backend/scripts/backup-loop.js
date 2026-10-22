import path from 'node:path';
import crypto from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { backupDatabase, pruneBackups } from '../src/lib/backups.js';

const source = process.env.SQLITE_PATH || '/app/data/payments.db';
const directory = process.env.BACKUP_DIR || '/app/backups';
const retentionDays = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS) || 30);
const controller = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => controller.abort());

while (!controller.signal.aborted) {
  let delay = 24 * 60 * 60 * 1000;
  try {
    const name = `payments-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}.db`;
    const result = await backupDatabase(source, path.join(directory, name));
    const removed = pruneBackups(directory, retentionDays);
    console.log(JSON.stringify({ event: 'backup_completed', file: name, removed, ...result, time: new Date().toISOString() }));
  } catch (error) {
    console.error(JSON.stringify({ event: 'backup_failed', error: error.message, time: new Date().toISOString() }));
    delay = 5 * 60 * 1000;
  }
  try { await setTimeout(delay, undefined, { signal: controller.signal }); }
  catch (error) { if (error.name !== 'AbortError') throw error; }
}
