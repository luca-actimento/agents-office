import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentState } from './types.js';
import {
	launchNewTerminal,
	removeAgent,
	restoreAgents,
	persistAgents,
	sendExistingAgents,
	sendLayout,
	getProjectDirPath,
} from './agentManager.js';
import { ensureProjectScan } from './fileWatcher.js';
import { loadFurnitureAssets, sendAssetsToWebview, loadFloorTiles, sendFloorTilesToWebview, loadWallTiles, sendWallTilesToWebview, loadCharacterSprites, sendCharacterSpritesToWebview, loadDefaultLayout } from './assetLoader.js';
import { WORKSPACE_KEY_AGENT_SEATS, GLOBAL_KEY_SOUND_ENABLED, GLOBAL_KEY_DOOR_SOUND_ENABLED, GLOBAL_KEY_AGENT_SOUND_ENABLED } from './constants.js';
import { writeLayoutToFile, readLayoutFromFile, watchLayoutFile } from './layoutPersistence.js';
import type { LayoutWatcher } from './layoutPersistence.js';
import { setDebugLogging } from './debugLog.js';

export class AgentsOfficeViewProvider implements vscode.WebviewViewProvider {
	nextAgentId = { current: 1 };
	nextTerminalIndex = { current: 1 };
	agents = new Map<number, AgentState>();
	webviewView: vscode.WebviewView | undefined;

	// Per-agent timers
	fileWatchers = new Map<number, fs.FSWatcher>();
	pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
	waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
	jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();
	permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

	// /clear detection: project-level scan for new JSONL files
	activeAgentId = { current: null as number | null };
	knownJsonlFiles = new Set<string>();
	projectScanTimer = { current: null as ReturnType<typeof setInterval> | null };

	// Bundled default layout (loaded from assets/default-layout.json)
	defaultLayout: Record<string, unknown> | null = null;

	// Cross-window layout sync
	layoutWatcher: LayoutWatcher | null = null;

	constructor(private readonly context: vscode.ExtensionContext) {
		setDebugLogging(true);
	}

	private get extensionUri(): vscode.Uri {
		return this.context.extensionUri;
	}

	private get webview(): vscode.Webview | undefined {
		return this.webviewView?.webview;
	}

	private persistAgents = (): void => {
		persistAgents(this.agents, this.context);
	};

	resolveWebviewView(webviewView: vscode.WebviewView) {
		this.webviewView = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

		webviewView.webview.onDidReceiveMessage(async (message) => {
			if (message.type === 'openClaude') {
				await launchNewTerminal(
					this.nextAgentId, this.nextTerminalIndex,
					this.agents, this.activeAgentId, this.knownJsonlFiles,
					this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
					this.jsonlPollTimers, this.projectScanTimer,
					this.webview, this.persistAgents,
					message.folderPath as string | undefined,
					message.model as string | undefined,
				);
			} else if (message.type === 'focusAgent') {
				const agent = this.agents.get(message.id);
				if (agent) {
					agent.terminalRef.show();
				}
			} else if (message.type === 'closeAgent') {
				const agent = this.agents.get(message.id);
				if (agent) {
					agent.terminalRef.dispose();
				}
			} else if (message.type === 'saveAgentSeats') {
				// Store seat assignments in a separate key (never touched by persistAgents)
				console.log(`[Agents Office] saveAgentSeats:`, JSON.stringify(message.seats));
				this.context.workspaceState.update(WORKSPACE_KEY_AGENT_SEATS, message.seats);
			} else if (message.type === 'saveLayout') {
				this.layoutWatcher?.markOwnWrite();
				writeLayoutToFile(message.layout as Record<string, unknown>);
			} else if (message.type === 'setSoundEnabled') {
				this.context.globalState.update(GLOBAL_KEY_SOUND_ENABLED, message.enabled);
			} else if (message.type === 'setDoorSoundEnabled') {
				this.context.globalState.update(GLOBAL_KEY_DOOR_SOUND_ENABLED, message.enabled);
			} else if (message.type === 'setAgentSoundEnabled') {
				this.context.globalState.update(GLOBAL_KEY_AGENT_SOUND_ENABLED, message.enabled);
			} else if (message.type === 'webviewReady') {
				await restoreAgents(
					this.context,
					this.nextAgentId, this.nextTerminalIndex,
					this.agents, this.knownJsonlFiles,
					this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
					this.jsonlPollTimers, this.projectScanTimer, this.activeAgentId,
					this.webview, this.persistAgents,
				);
				// Send persisted settings to webview
				const soundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true);
				const doorSoundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_DOOR_SOUND_ENABLED, true);
				const agentSoundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_AGENT_SOUND_ENABLED, true);
				this.webview?.postMessage({ type: 'settingsLoaded', soundEnabled, doorSoundEnabled, agentSoundEnabled });

				// Send workspace folders to webview
				const wsFolders = vscode.workspace.workspaceFolders;
				if (wsFolders && wsFolders.length >= 1) {
					this.webview?.postMessage({
						type: 'workspaceFolders',
						folders: wsFolders.map(f => ({ name: f.name, path: f.uri.fsPath })),
					});
				}

				// Scan known project directories and send to webview
				const homeDir = os.homedir();
				const projects: { name: string; path: string }[] = [];

				// Load projects from central registry (~/.claude/projects-registry.json)
				const registryPath = path.join(homeDir, '.claude', 'projects-registry.json');
				let registryLoaded = false;
				try {
					const raw = fs.readFileSync(registryPath, 'utf-8');
					const registry = JSON.parse(raw) as { projects: { key: string; name: string; dir: string }[] };
					for (const p of registry.projects ?? []) {
						const dir = p.dir.replace(/^~/, homeDir);
						try {
							if (fs.statSync(dir).isDirectory()) {
								projects.push({ name: p.name, path: dir });
							}
						} catch { /* dir doesn't exist, skip */ }
					}
					registryLoaded = true;
				} catch { /* registry missing, fall back to scan */ }

				// Fallback: scan known roots if registry not available
				if (!registryLoaded) {
					const scanRoots = [
						path.join(homeDir, 'Projekte'),
						path.join(homeDir, 'Work', 'actimento'),
						path.join(homeDir, 'Work', 'actimento', 'aktive projekte'),
					];
					for (const root of scanRoots) {
						try {
							const entries = fs.readdirSync(root, { withFileTypes: true });
							for (const entry of entries) {
								if (entry.isDirectory()) {
									projects.push({ name: entry.name, path: path.join(root, entry.name) });
								}
							}
						} catch { /* dir doesn't exist */ }
					}
					const standaloneProjects = [path.join(homeDir, 'actimento-hub')];
					for (const p of standaloneProjects) {
						try {
							if (fs.statSync(p).isDirectory()) {
								projects.push({ name: path.basename(p), path: p });
							}
						} catch { /* doesn't exist */ }
					}
				}

				// Deduplicate by path
				const seen = new Set<string>();
				const uniqueProjects = projects.filter(p => {
					if (seen.has(p.path)) return false;
					seen.add(p.path);
					return true;
				});

				this.webview?.postMessage({ type: 'projectsList', projects: uniqueProjects });

				// Ensure project scan runs even with no restored agents (to adopt external terminals)
				const projectDir = getProjectDirPath();
				const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
				console.log('[Extension] workspaceRoot:', workspaceRoot);
				console.log('[Extension] projectDir:', projectDir);
				if (projectDir) {
					ensureProjectScan(
						projectDir, this.knownJsonlFiles, this.projectScanTimer, this.activeAgentId,
						this.nextAgentId, this.agents,
						this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
						this.webview, this.persistAgents,
					);

					// Load furniture assets BEFORE sending layout
					(async () => {
						try {
							console.log('[Extension] Loading furniture assets...');
							const extensionPath = this.extensionUri.fsPath;
							console.log('[Extension] extensionPath:', extensionPath);

							// Check bundled location first: extensionPath/dist/assets/
							const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
							let assetsRoot: string | null = null;
							if (fs.existsSync(bundledAssetsDir)) {
								console.log('[Extension] Found bundled assets at dist/');
								assetsRoot = path.join(extensionPath, 'dist');
							} else if (workspaceRoot) {
								// Fall back to workspace root (development or external assets)
								console.log('[Extension] Trying workspace for assets...');
								assetsRoot = workspaceRoot;
							}

							if (!assetsRoot) {
								console.log('[Extension] ⚠️  No assets directory found');
								if (this.webview) {
									sendLayout(this.context, this.webview, this.defaultLayout);
									this.startLayoutWatcher();
								}
								return;
							}

							console.log('[Extension] Using assetsRoot:', assetsRoot);

							// Load bundled default layout
							this.defaultLayout = loadDefaultLayout(assetsRoot);

							// Load character sprites
							const charSprites = await loadCharacterSprites(assetsRoot);
							if (charSprites && this.webview) {
								console.log('[Extension] Character sprites loaded, sending to webview');
								sendCharacterSpritesToWebview(this.webview, charSprites);
							}

							// Load floor tiles
							const floorTiles = await loadFloorTiles(assetsRoot);
							if (floorTiles && this.webview) {
								console.log('[Extension] Floor tiles loaded, sending to webview');
								sendFloorTilesToWebview(this.webview, floorTiles);
							}

							// Load wall tiles
							const wallTiles = await loadWallTiles(assetsRoot);
							if (wallTiles && this.webview) {
								console.log('[Extension] Wall tiles loaded, sending to webview');
								sendWallTilesToWebview(this.webview, wallTiles);
							}

							const assets = await loadFurnitureAssets(assetsRoot);
							if (assets && this.webview) {
								console.log('[Extension] ✅ Assets loaded, sending to webview');
								sendAssetsToWebview(this.webview, assets);
							}
						} catch (err) {
							console.error('[Extension] ❌ Error loading assets:', err);
						}
						// Always send saved layout (or null for default)
						if (this.webview) {
							console.log('[Extension] Sending saved layout');
							sendLayout(this.context, this.webview, this.defaultLayout);
							this.startLayoutWatcher();
						}
					})();
				} else {
					// No project dir — still try to load floor/wall tiles, then send saved layout
					(async () => {
						try {
							const ep = this.extensionUri.fsPath;
							const bundled = path.join(ep, 'dist', 'assets');
							if (fs.existsSync(bundled)) {
								const distRoot = path.join(ep, 'dist');
								this.defaultLayout = loadDefaultLayout(distRoot);
								const cs = await loadCharacterSprites(distRoot);
								if (cs && this.webview) {
									sendCharacterSpritesToWebview(this.webview, cs);
								}
								const ft = await loadFloorTiles(distRoot);
								if (ft && this.webview) {
									sendFloorTilesToWebview(this.webview, ft);
								}
								const wt = await loadWallTiles(distRoot);
								if (wt && this.webview) {
									sendWallTilesToWebview(this.webview, wt);
								}
								const assets = await loadFurnitureAssets(distRoot);
								if (assets && this.webview) {
									sendAssetsToWebview(this.webview, assets);
								}
							}
						} catch { /* ignore */ }
						if (this.webview) {
							sendLayout(this.context, this.webview, this.defaultLayout);
							this.startLayoutWatcher();
						}
					})();
				}
				sendExistingAgents(this.agents, this.context, this.webview);
			} else if (message.type === 'pickFolderAndOpenClaude') {
				const uris = await vscode.window.showOpenDialog({
					canSelectFolders: true,
					canSelectFiles: false,
					canSelectMany: false,
					openLabel: 'Start Claude here',
				});
				if (uris && uris.length > 0) {
					await launchNewTerminal(
						this.nextAgentId, this.nextTerminalIndex,
						this.agents, this.activeAgentId, this.knownJsonlFiles,
						this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
						this.jsonlPollTimers, this.projectScanTimer,
						this.webview, this.persistAgents,
						uris[0].fsPath,
						message.model as string | undefined,
					);
				}
			} else if (message.type === 'furnitureAction') {
				const actionsFilePath = path.join(os.homedir(), '.agents-office', 'furniture-actions.json');
				try {
					if (fs.existsSync(actionsFilePath)) {
						const actionsData = JSON.parse(fs.readFileSync(actionsFilePath, 'utf-8'));
						const actionConfig = actionsData[message.uid] || actionsData[message.furnitureType];
						if (actionConfig) {
							if (actionConfig.type === 'openFile') {
								const filePath = actionConfig.path.replace(/^~/, os.homedir());
								vscode.env.openExternal(vscode.Uri.file(filePath));
							} else if (actionConfig.type === 'runCommand') {
								const cmd = actionConfig.command.replace(/^~/, os.homedir());
								const t = vscode.window.createTerminal({ name: actionConfig.label || 'Office Action' });
								t.sendText(cmd);
								t.show();
							} else if (actionConfig.type === 'runInBackground') {
								const cmd = actionConfig.command.replace(/^~/, os.homedir());
								exec(cmd, (err) => {
									if (err) { console.error('[Agents Office] furnitureAction exec error:', err); }
								});
							}
						}
					}
				} catch (e) {
					console.error('[Agents Office] furnitureAction error:', e);
				}
			} else if (message.type === 'openSessionsFolder') {
				const projectDir = getProjectDirPath();
				if (projectDir && fs.existsSync(projectDir)) {
					vscode.env.openExternal(vscode.Uri.file(projectDir));
				}
			} else if (message.type === 'exportLayout') {
				const layout = readLayoutFromFile();
				if (!layout) {
					vscode.window.showWarningMessage('Agents Office: No saved layout to export.');
					return;
				}
				const uri = await vscode.window.showSaveDialog({
					filters: { 'JSON Files': ['json'] },
					defaultUri: vscode.Uri.file(path.join(os.homedir(), 'agents-office-layout.json')),
				});
				if (uri) {
					fs.writeFileSync(uri.fsPath, JSON.stringify(layout, null, 2), 'utf-8');
					vscode.window.showInformationMessage('Agents Office: Layout exported successfully.');
				}
			} else if (message.type === 'importLayout') {
				const uris = await vscode.window.showOpenDialog({
					filters: { 'JSON Files': ['json'] },
					canSelectMany: false,
				});
				if (!uris || uris.length === 0) return;
				try {
					const raw = fs.readFileSync(uris[0].fsPath, 'utf-8');
					const imported = JSON.parse(raw) as Record<string, unknown>;
					if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
						vscode.window.showErrorMessage('Agents Office: Invalid layout file.');
						return;
					}
					this.layoutWatcher?.markOwnWrite();
					writeLayoutToFile(imported);
					this.webview?.postMessage({ type: 'layoutLoaded', layout: imported });
					vscode.window.showInformationMessage('Agents Office: Layout imported successfully.');
				} catch {
					vscode.window.showErrorMessage('Agents Office: Failed to read or parse layout file.');
				}
			}
		});

		vscode.window.onDidChangeActiveTerminal((terminal) => {
			this.activeAgentId.current = null;
			if (!terminal) return;
			for (const [id, agent] of this.agents) {
				if (agent.terminalRef === terminal) {
					this.activeAgentId.current = id;
					webviewView.webview.postMessage({ type: 'agentSelected', id });
					break;
				}
			}
		});

		vscode.window.onDidCloseTerminal((closed) => {
			for (const [id, agent] of this.agents) {
				if (agent.terminalRef === closed) {
					if (this.activeAgentId.current === id) {
						this.activeAgentId.current = null;
					}
					removeAgent(
						id, this.agents,
						this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
						this.jsonlPollTimers, this.persistAgents,
					);
					webviewView.webview.postMessage({ type: 'agentClosed', id });
				}
			}
		});
	}

	/** Export current saved layout to webview-ui/public/assets/default-layout.json (dev utility) */
	exportDefaultLayout(): void {
		const layout = readLayoutFromFile();
		if (!layout) {
			vscode.window.showWarningMessage('Agents Office: No saved layout found.');
			return;
		}
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('Agents Office: No workspace folder found.');
			return;
		}
		const targetPath = path.join(workspaceRoot, 'webview-ui', 'public', 'assets', 'default-layout.json');
		const json = JSON.stringify(layout, null, 2);
		fs.writeFileSync(targetPath, json, 'utf-8');
		vscode.window.showInformationMessage(`Agents Office: Default layout exported to ${targetPath}`);
	}

	testSubagent(): void {
		const parentId = 9999;
		const toolId = 'test-sub-' + Date.now();
		this.webview?.postMessage({ type: 'agentToolStart', id: parentId, toolId, status: 'Subtask: Visueller Test 👋' });
		setTimeout(() => {
			this.webview?.postMessage({ type: 'agentToolsClear', id: parentId });
		}, 10000);
	}

	private startLayoutWatcher(): void {
		if (this.layoutWatcher) return;
		this.layoutWatcher = watchLayoutFile((layout) => {
			console.log('[Agents Office] External layout change — pushing to webview');
			this.webview?.postMessage({ type: 'layoutLoaded', layout });
		});
	}

	dispose() {
		this.layoutWatcher?.dispose();
		this.layoutWatcher = null;
		for (const id of [...this.agents.keys()]) {
			removeAgent(
				id, this.agents,
				this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
				this.jsonlPollTimers, this.persistAgents,
			);
		}
		if (this.projectScanTimer.current) {
			clearInterval(this.projectScanTimer.current);
			this.projectScanTimer.current = null;
		}
	}
}

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
	const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

	let html = fs.readFileSync(indexPath, 'utf-8');

	html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
		const fileUri = vscode.Uri.joinPath(distPath, filePath);
		const webviewUri = webview.asWebviewUri(fileUri);
		return `${attr}="${webviewUri}"`;
	});

	return html;
}
