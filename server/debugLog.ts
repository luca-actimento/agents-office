import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const LOG_FILE = path.join(os.homedir(), '.agents-office', 'server-debug.log');
const MAX_LOG_BYTES = 2 * 1024 * 1024;

let _enabled = false;

export function setDebugLogging(enabled: boolean): void {
	_enabled = enabled;
	if (enabled) {
		try {
			fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
			fs.writeFileSync(LOG_FILE, `=== agents-office server debug log started ${new Date().toISOString()} ===\n`);
		} catch { /* ignore */ }
	}
}

export function debugLog(message: string): void {
	if (!_enabled) return;
	try {
		const line = `${new Date().toISOString()} ${message}\n`;
		try {
			const stat = fs.statSync(LOG_FILE);
			if (stat.size > MAX_LOG_BYTES) {
				fs.writeFileSync(LOG_FILE, line);
				return;
			}
		} catch { /* file doesn't exist yet */ }
		fs.appendFileSync(LOG_FILE, line);
	} catch { /* ignore */ }
}
