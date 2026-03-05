import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LAYOUT_FILE_DIR, LAYOUT_FILE_NAME, LAYOUT_FILE_POLL_INTERVAL_MS } from './constants.js';

export interface LayoutWatcher {
	markOwnWrite(): void;
	dispose(): void;
}

function getLayoutFilePath(): string {
	return path.join(os.homedir(), LAYOUT_FILE_DIR, LAYOUT_FILE_NAME);
}

export function readLayoutFromFile(): Record<string, unknown> | null {
	const filePath = getLayoutFilePath();
	try {
		if (!fs.existsSync(filePath)) return null;
		return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
	} catch { return null; }
}

export function writeLayoutToFile(layout: Record<string, unknown>): void {
	const filePath = getLayoutFilePath();
	try {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		const tmp = filePath + '.tmp';
		fs.writeFileSync(tmp, JSON.stringify(layout, null, 2), 'utf-8');
		fs.renameSync(tmp, filePath);
	} catch (err) { console.error('[Server] Failed to write layout:', err); }
}

export function loadLayout(defaultLayout?: Record<string, unknown> | null): Record<string, unknown> | null {
	const fromFile = readLayoutFromFile();
	if (fromFile) return fromFile;
	if (defaultLayout) { writeLayoutToFile(defaultLayout); return defaultLayout; }
	return null;
}

export function watchLayoutFile(onExternalChange: (layout: Record<string, unknown>) => void): LayoutWatcher {
	const filePath = getLayoutFilePath();
	let skipNextChange = false, lastMtime = 0, fsWatcher: fs.FSWatcher | null = null, disposed = false;
	try { if (fs.existsSync(filePath)) lastMtime = fs.statSync(filePath).mtimeMs; } catch { /* ignore */ }

	function checkForChange(): void {
		if (disposed) return;
		try {
			if (!fs.existsSync(filePath)) return;
			const stat = fs.statSync(filePath);
			if (stat.mtimeMs <= lastMtime) return;
			lastMtime = stat.mtimeMs;
			if (skipNextChange) { skipNextChange = false; return; }
			onExternalChange(JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>);
		} catch { /* ignore */ }
	}

	function startFsWatch(): void {
		if (disposed || fsWatcher) return;
		try {
			if (!fs.existsSync(filePath)) return;
			fsWatcher = fs.watch(filePath, checkForChange);
			fsWatcher.on('error', () => { fsWatcher?.close(); fsWatcher = null; });
		} catch { /* file may not exist yet */ }
	}

	startFsWatch();
	const pollTimer = setInterval(() => { if (!fsWatcher) startFsWatch(); checkForChange(); }, LAYOUT_FILE_POLL_INTERVAL_MS);

	return {
		markOwnWrite(): void {
			skipNextChange = true;
			try { if (fs.existsSync(filePath)) lastMtime = fs.statSync(filePath).mtimeMs; } catch { /* ignore */ }
		},
		dispose(): void {
			disposed = true; fsWatcher?.close(); fsWatcher = null; clearInterval(pollTimer);
		},
	};
}
