import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

export function verifyDatabase(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('SQLite integrity check failed');
    if (db.pragma('foreign_key_check').length) throw new Error('SQLite foreign key check failed');
    for (const name of ['payments', 'sessions', 'schema_migrations']) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)) {
        throw new Error(`Missing application table: ${name}`);
      }
    }
    return { payments: db.prepare('SELECT COUNT(*) AS count FROM payments').get().count,
      sessions: db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count };
  } finally { db.close(); }
}

/** SQLite online backup includes committed WAL pages; copying payments.db alone does not. */
export async function backupDatabase(source, destination) {
  source = path.resolve(source); destination = path.resolve(destination);
  if (source === destination || fs.existsSync(destination)) throw new Error('Destination must be a new file');
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await db.backup(temporary);
    const result = verifyDatabase(temporary);
    fs.chmodSync(temporary, 0o600);
    // Atomic publication on the same filesystem; never replace an existing backup.
    fs.linkSync(temporary, destination);
    return result;
  } finally {
    db.close();
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

/** Restore into a NEW path; switching the running application is a separate operator action. */
export async function restoreDatabase(source, destination) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(`${destination}${suffix}`)) throw new Error('Restore target or WAL files already exist');
  }
  verifyDatabase(source);
  return backupDatabase(source, destination);
}

/** Remove only backup files created by this application and older than retention. */
export function pruneBackups(directory, retentionDays = 30, now = Date.now()) {
  const cutoff = now - Math.max(1, Number(retentionDays) || 30) * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^payments-\d{4}-\d{2}-\d{2}T[\d-]+Z-[0-9a-f-]{36}\.db$/i.test(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (fs.statSync(file).mtimeMs < cutoff) {
      fs.unlinkSync(file);
      removed += 1;
    }
  }
  return removed;
}
