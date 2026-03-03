import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import {
	UPDATE_CHECK_REPO,
	UPDATE_CHECK_INTERVAL_MS,
	GLOBAL_KEY_LAST_UPDATE_CHECK,
	GLOBAL_KEY_SKIPPED_VERSION
} from './constants.js';

interface GitHubRelease {
	tag_name: string;
	assets: { name: string; browser_download_url: string }[];
}

function compareVersions(a: string, b: string): number {
	const pa = a.split('.').map(Number);
	const pb = b.split('.').map(Number);
	for (let i = 0; i < 3; i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

function fetchJson(url: string): Promise<GitHubRelease> {
	return new Promise((resolve, reject) => {
		const req = https.get(url, { headers: { 'User-Agent': 'agents-office-vscode' } }, (res) => {
			if (res.statusCode === 301 || res.statusCode === 302) {
				const location = res.headers.location;
				if (location) { fetchJson(location).then(resolve, reject); return; }
			}
			if (res.statusCode !== 200) {
				reject(new Error(`HTTP ${res.statusCode}`));
				return;
			}
			let data = '';
			res.on('data', (chunk: string) => { data += chunk; });
			res.on('end', () => {
				try { resolve(JSON.parse(data) as GitHubRelease); }
				catch (e) { reject(e); }
			});
		});
		req.on('error', reject);
		req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
	});
}

function downloadFile(url: string, dest: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const req = https.get(url, { headers: { 'User-Agent': 'agents-office-vscode' } }, (res) => {
			if (res.statusCode === 301 || res.statusCode === 302) {
				const location = res.headers.location;
				if (location) { downloadFile(location, dest).then(resolve, reject); return; }
			}
			if (res.statusCode !== 200) {
				reject(new Error(`HTTP ${res.statusCode}`));
				return;
			}
			const file = fs.createWriteStream(dest);
			res.pipe(file);
			file.on('finish', () => { file.close(() => resolve()); });
		});
		req.on('error', reject);
		req.setTimeout(60000, () => { req.destroy(); reject(new Error('timeout')); });
	});
}

export async function checkForUpdate(context: vscode.ExtensionContext): Promise<void> {
	try {
		const lastCheck = context.globalState.get<number>(GLOBAL_KEY_LAST_UPDATE_CHECK) ?? 0;
		if (Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;

		const release = await fetchJson(
			`https://api.github.com/repos/${UPDATE_CHECK_REPO}/releases/latest`
		);

		const remoteVersion = release.tag_name.replace(/^v/, '');
		const localVersion = context.extension.packageJSON.version as string;

		if (compareVersions(remoteVersion, localVersion) <= 0) {
			await context.globalState.update(GLOBAL_KEY_LAST_UPDATE_CHECK, Date.now());
			return;
		}

		const skipped = context.globalState.get<string>(GLOBAL_KEY_SKIPPED_VERSION);
		if (skipped === remoteVersion) return;

		await context.globalState.update(GLOBAL_KEY_LAST_UPDATE_CHECK, Date.now());

		const vsixAsset = release.assets.find(a => a.name.endsWith('.vsix'));
		if (!vsixAsset) return;

		const choice = await vscode.window.showInformationMessage(
			`Agents Office v${remoteVersion} ist verfügbar (aktuell: v${localVersion})`,
			'Update installieren',
			'Später'
		);

		if (choice === 'Update installieren') {
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Agents Office Update...' },
				async (progress) => {
					progress.report({ message: 'Lade herunter...' });
					const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-office-'));
					const vsixPath = path.join(tmpDir, vsixAsset.name);

					try {
						await downloadFile(vsixAsset.browser_download_url, vsixPath);
						progress.report({ message: 'Installiere...' });

						await new Promise<void>((resolve, reject) => {
							cp.exec(
								`code --install-extension "${vsixPath}" --force`,
								(err) => err ? reject(err) : resolve()
							);
						});

						const reload = await vscode.window.showInformationMessage(
							`Agents Office v${remoteVersion} installiert!`,
							'Jetzt neu laden'
						);
						if (reload) {
							vscode.commands.executeCommand('workbench.action.reloadWindow');
						}
					} finally {
						fs.rmSync(tmpDir, { recursive: true, force: true });
					}
				}
			);
		} else if (choice === 'Später') {
			await context.globalState.update(GLOBAL_KEY_SKIPPED_VERSION, remoteVersion);
		}
	} catch {
		// Update-Check fehlgeschlagen — still ignorieren
	}
}
