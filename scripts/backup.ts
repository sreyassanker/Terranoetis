import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export function backupDatabase(dbPath: string = './data/terra_umbra.db'): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join('./backups', timestamp);
  fs.mkdirSync(backupDir, { recursive: true });

  const backupPath = path.join(backupDir, 'terra_umbra.db');

  execSync(`sqlite3 "${dbPath}" ".backup '${backupPath}'"`, { stdio: 'ignore' });
  console.log(`[BACKUP] Database backed up to ${backupPath}`);

  const logsDir = './logs';
  if (fs.existsSync(logsDir)) {
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(logsDir)) {
      const fullPath = path.join(logsDir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isFile() && now - stat.mtimeMs > sevenDays) {
        fs.unlinkSync(fullPath);
        console.log(`[BACKUP] Removed old log: ${entry}`);
      }
    }
  }

  return backupPath;
}
