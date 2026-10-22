import { backupDatabase, restoreDatabase, verifyDatabase } from '../src/lib/backups.js';

const [command, source, destination] = process.argv.slice(2);
try {
  if (!source || !['backup', 'restore', 'verify'].includes(command) || (command !== 'verify' && !destination)) {
    throw new Error('Usage: node scripts/database.js backup|restore SOURCE NEW_DESTINATION, or verify SOURCE');
  }
  const result = command === 'verify' ? verifyDatabase(source)
    : await (command === 'backup' ? backupDatabase : restoreDatabase)(source, destination);
  console.log(JSON.stringify({ success: true, command, ...result }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
