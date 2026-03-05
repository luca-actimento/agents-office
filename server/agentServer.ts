import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { WebSocket } from 'ws';
import type { AgentState, Broadcaster } from './types.js';
import {
	launchNewTerminal,
	removeAgent,
	persistAgents,
	sendExistingAgents,
	getProjectDirPath,
} from './agentManager.js';
import { ensureProjectScan } from './fileWatcher.js';
import { loadLayout, writeLayoutToFile, readLayoutFromFile, watchLayoutFile } from './layoutPersistence.js';
import type { LayoutWatcher } from './layoutPersistence.js';
import {
	loadFurnitureAssets,
	loadFloorTiles,
	loadWallTiles,
	loadCharacterSprites,
	loadDefaultLayout,
} from './assetLoader.js';
import { LAYOUTS_SUBDIR } from './constants.js';
import { DEFAULT_LAYOUT_STR as DEFAULT_LAYOUT } from './defaultLayout.js';

// Agent seat persistence (palette / hueShift / seatId per agent)
const SEATS_FILE = path.join(os.homedir(), '.agents-office', 'server-agent-seats.json');
const SETTINGS_FILE = path.join(os.homedir(), '.agents-office', 'server-settings.json');

function loadSeats(): Record<string, { palette?: number; hueShift?: number; seatId?: string }> {
	try {
		if (fs.existsSync(SEATS_FILE)) return JSON.parse(fs.readFileSync(SEATS_FILE, 'utf-8'));
	} catch { /* ignore */ }
	return {};
}
function saveSeats(seats: Record<string, unknown>): void {
	try {
		fs.mkdirSync(path.dirname(SEATS_FILE), { recursive: true });
		fs.writeFileSync(SEATS_FILE, JSON.stringify(seats, null, 2), 'utf-8');
	} catch { /* ignore */ }
}
function loadSettings(): { soundEnabled: boolean; doorSoundEnabled: boolean; agentSoundEnabled: boolean } {
	try {
		if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
	} catch { /* ignore */ }
	return { soundEnabled: true, doorSoundEnabled: true, agentSoundEnabled: true };
}
function saveSettings(settings: Record<string, unknown>): void {
	try {
		fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
		fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...loadSettings(), ...settings }, null, 2), 'utf-8');
	} catch { /* ignore */ }
}

/** Broadcasts a message to all connected WebSocket clients */
class WsBroadcaster implements Broadcaster {
	constructor(private clients: Set<WebSocket>) {}
	postMessage(msg: unknown): void {
		const json = JSON.stringify(msg);
		for (const ws of this.clients) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(json);
			}
		}
	}
}

/** Sends a message to a single client */
function sendToClient(ws: WebSocket, msg: unknown): void {
	if (ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(msg));
	}
}

export class AgentServer {
	private clients = new Set<WebSocket>();
	private broadcaster: WsBroadcaster;

	// Agent state
	private agents = new Map<number, AgentState>();
	private nextAgentId = { current: 1 };
	private nextTerminalIndex = { current: 1 };
	private activeAgentId = { current: null as number | null };
	private knownJsonlFiles = new Set<string>();
	private projectScanTimer = { current: null as ReturnType<typeof setInterval> | null };

	// Timers per agent
	private fileWatchers = new Map<number, fs.FSWatcher>();
	private pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
	private waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
	private permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
	private jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();

	// Layout
	private layoutWatcher: LayoutWatcher | null = null;
	private defaultLayout: Record<string, unknown> | null = null;

	// Assets root
	private assetsRoot: string;

	constructor() {
		this.broadcaster = new WsBroadcaster(this.clients);

		// In CJS bundle __cjsBundleFilename is set by banner; in dev tsx use import.meta.url
		const serverDir = (globalThis as { __cjsBundleFilename?: string }).__cjsBundleFilename
			? path.dirname((globalThis as { __cjsBundleFilename: string }).__cjsBundleFilename)
			: path.dirname(new URL(import.meta.url).pathname);
		// Bundled CJS: serverDir = dist/server/ → assets at dist/
		// Dev tsx:     serverDir = server/       → assets at ../dist/
		this.assetsRoot = serverDir.includes(`${path.sep}dist${path.sep}server`)
			? path.resolve(serverDir, '..')
			: path.resolve(serverDir, '..', 'dist');
	}

	private doPersist = (): void => {
		persistAgents(this.agents);
	};

	private onTerminalData = (agentId: number, data: string): void => {
		const json = JSON.stringify({ type: 'terminalData', id: agentId, data });
		for (const ws of this.clients) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(json);
			}
		}
	};

	addClient(ws: WebSocket): void {
		this.clients.add(ws);
		console.log(`[Server] Client connected (total: ${this.clients.size})`);
	}

	removeClient(ws: WebSocket): void {
		this.clients.delete(ws);
		console.log(`[Server] Client disconnected (total: ${this.clients.size})`);
	}

	async handleMessage(ws: WebSocket, message: Record<string, unknown>): Promise<void> {
		const type = message.type as string;

		if (type === 'webviewReady') {
			await this.onWebviewReady(ws);

		} else if (type === 'openClaude') {
			await launchNewTerminal(
				this.nextAgentId, this.nextTerminalIndex,
				this.agents, this.activeAgentId, this.knownJsonlFiles,
				this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
				this.jsonlPollTimers, this.projectScanTimer,
				this.broadcaster, this.onTerminalData, this.doPersist,
				message.folderPath as string | undefined,
				message.model as string | undefined,
			);

		} else if (type === 'pickFolderAndOpenClaude') {
			// In browser mode, just use homedir as fallback (no native folder picker)
			// The client should handle this by showing a project dropdown instead
			await launchNewTerminal(
				this.nextAgentId, this.nextTerminalIndex,
				this.agents, this.activeAgentId, this.knownJsonlFiles,
				this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
				this.jsonlPollTimers, this.projectScanTimer,
				this.broadcaster, this.onTerminalData, this.doPersist,
				undefined,
				message.model as string | undefined,
			);

		} else if (type === 'focusAgent') {
			// In browser mode, focusing the agent means selecting it — no PTY to show, just notify
			const id = message.id as number;
			this.activeAgentId.current = id;
			this.broadcaster.postMessage({ type: 'agentSelected', id });

		} else if (type === 'closeAgent') {
			const id = message.id as number;
			removeAgent(
				id, this.agents, this.fileWatchers, this.pollingTimers, this.waitingTimers,
				this.permissionTimers, this.jsonlPollTimers, this.doPersist,
			);
			this.broadcaster.postMessage({ type: 'agentGoingHome', id });

		} else if (type === 'terminalInput') {
			const id = message.id as number;
			const data = message.data as string;
			const agent = this.agents.get(id);
			if (agent?.ptyProcess) {
				agent.ptyProcess.write(data);
			}

		} else if (type === 'terminalResize') {
			const id = message.id as number;
			const cols = message.cols as number;
			const rows = message.rows as number;
			const agent = this.agents.get(id);
			if (agent?.ptyProcess) {
				agent.ptyProcess.resize(cols, rows);
			}

		} else if (type === 'terminalRequestReplay') {
			// Client wants current terminal state — nothing to replay for PTY
			// Just acknowledge so the terminal knows the connection is alive
			sendToClient(ws, { type: 'terminalReplayDone', id: message.id });

		} else if (type === 'saveAgentSeats') {
			saveSeats(message.seats as Record<string, unknown>);

		} else if (type === 'saveLayout') {
			this.layoutWatcher?.markOwnWrite();
			writeLayoutToFile(message.layout as Record<string, unknown>);

		} else if (type === 'setSoundEnabled') {
			saveSettings({ soundEnabled: message.enabled });

		} else if (type === 'setDoorSoundEnabled') {
			saveSettings({ doorSoundEnabled: message.enabled });

		} else if (type === 'setAgentSoundEnabled') {
			saveSettings({ agentSoundEnabled: message.enabled });

		} else if (type === 'furnitureAction') {
			this.handleFurnitureAction(message);

		} else if (type === 'listLayouts') {
			const layoutsDir = path.join(os.homedir(), LAYOUTS_SUBDIR);
			const userLayouts: { name: string; filename: string }[] = [];
			if (fs.existsSync(layoutsDir)) {
				for (const f of fs.readdirSync(layoutsDir).filter(f => f.endsWith('.json')).sort()) {
					userLayouts.push({ name: f.replace(/\.json$/, ''), filename: f });
				}
			}
			sendToClient(ws, { type: 'layoutsList', builtin: [{ name: 'Office Default', filename: '__builtin__' }], user: userLayouts });

		} else if (type === 'loadLayout') {
			try {
				const raw = message.filename === '__builtin__'
					? DEFAULT_LAYOUT
					: fs.readFileSync(path.join(os.homedir(), LAYOUTS_SUBDIR, message.filename as string), 'utf-8');
				const layout = JSON.parse(raw) as Record<string, unknown>;
				this.layoutWatcher?.markOwnWrite();
				writeLayoutToFile(layout);
				this.broadcaster.postMessage({ type: 'layoutLoaded', layout });
			} catch {
				console.error('[Server] Failed to load layout:', message.filename);
			}

		} else if (type === 'saveLayoutAs') {
			const name = (message.name as string).trim();
			if (!name) return;
			const layoutsDir = path.join(os.homedir(), LAYOUTS_SUBDIR);
			fs.mkdirSync(layoutsDir, { recursive: true });
			const current = readLayoutFromFile();
			if (!current) return;
			const filename = name.replace(/[^a-z0-9_-]/gi, '-').toLowerCase() + '.json';
			fs.writeFileSync(path.join(layoutsDir, filename), JSON.stringify(current), 'utf-8');
			this.broadcaster.postMessage({ type: 'layoutSaved', name, filename });

		} else if (type === 'exportLayout') {
			// No-op in browser mode (no native save dialog)

		} else if (type === 'importLayout') {
			// No-op in browser mode

		} else if (type === 'openSessionsFolder') {
			const cwd = process.cwd();
			const projectDir = getProjectDirPath(cwd);
			if (projectDir && fs.existsSync(projectDir)) {
				exec(`open "${projectDir}"`);
			}
		}
	}

	private async onWebviewReady(ws: WebSocket): Promise<void> {
		console.log('[Server] Webview ready, sending initial state...');

		// Settings
		const settings = loadSettings();
		sendToClient(ws, { type: 'settingsLoaded', ...settings });

		// Projects list
		const projects = this.discoverProjects();
		sendToClient(ws, { type: 'projectsList', projects });

		// Load assets (only once)
		if (!this.defaultLayout) {
			await this.loadAssets();
		}

		// Send all assets to the new client
		await this.sendAssetsToClient(ws);

		// Send layout
		const layout = loadLayout(this.defaultLayout);
		sendToClient(ws, { type: 'layoutLoaded', layout });
		this.startLayoutWatcher();

		// Send existing agents
		const seats = loadSeats();
		sendExistingAgents(this.agents, seats, { postMessage: (msg) => sendToClient(ws, msg) });

		// Start project scan for default cwd
		const cwd = process.cwd();
		const projectDir = getProjectDirPath(cwd);
		ensureProjectScan(
			projectDir, this.knownJsonlFiles, this.projectScanTimer, this.activeAgentId,
			this.nextAgentId, this.agents,
			this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
			this.broadcaster, this.doPersist,
		);
	}

	private async loadAssets(): Promise<void> {
		if (!fs.existsSync(path.join(this.assetsRoot, 'assets'))) {
			console.log('[Server] No assets directory found at:', this.assetsRoot);
			return;
		}

		this.defaultLayout = loadDefaultLayout(this.assetsRoot);
		console.log('[Server] Assets root:', this.assetsRoot);
	}

	private async sendAssetsToClient(ws: WebSocket): Promise<void> {
		const send = (msg: unknown) => sendToClient(ws, msg);
		const assetsRoot = this.assetsRoot;

		if (!fs.existsSync(path.join(assetsRoot, 'assets'))) return;

		try {
			const charSprites = await loadCharacterSprites(assetsRoot);
			if (charSprites) send({ type: 'characterSpritesLoaded', characters: charSprites.characters });

			const floorTiles = await loadFloorTiles(assetsRoot);
			if (floorTiles) send({ type: 'floorTilesLoaded', sprites: floorTiles.sprites });

			const wallTiles = await loadWallTiles(assetsRoot);
			if (wallTiles) send({ type: 'wallTilesLoaded', sprites: wallTiles.sprites });

			const assets = await loadFurnitureAssets(assetsRoot);
			if (assets) {
				const spritesObj: Record<string, string[][]> = {};
				for (const [id, spriteData] of assets.sprites) spritesObj[id] = spriteData;
				send({ type: 'furnitureAssetsLoaded', catalog: assets.catalog, sprites: spritesObj });
			}
		} catch (err) {
			console.error('[Server] Error sending assets:', err);
		}
	}

	private discoverProjects(): { name: string; path: string }[] {
		const homeDir = os.homedir();
		const projects: { name: string; path: string }[] = [];

		// Registry
		const registryPath = path.join(homeDir, '.claude', 'projects-registry.json');
		let registryLoaded = false;
		try {
			const raw = fs.readFileSync(registryPath, 'utf-8');
			const registry = JSON.parse(raw) as { projects: { key: string; name: string; dir: string }[] };
			for (const p of registry.projects ?? []) {
				const dir = p.dir.replace(/^~/, homeDir);
				try {
					if (fs.statSync(dir).isDirectory()) projects.push({ name: p.name, path: dir });
				} catch { /* skip */ }
			}
			registryLoaded = true;
		} catch { /* fallback */ }

		if (!registryLoaded) {
			const scanRoots = [
				path.join(homeDir, 'Projekte'),
				path.join(homeDir, 'Work', 'actimento'),
			];
			for (const root of scanRoots) {
				try {
					for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
						if (entry.isDirectory()) projects.push({ name: entry.name, path: path.join(root, entry.name) });
					}
				} catch { /* skip */ }
			}
		}

		// Deduplicate
		const seen = new Set<string>();
		return projects.filter(p => { if (seen.has(p.path)) return false; seen.add(p.path); return true; });
	}

	private handleFurnitureAction(message: Record<string, unknown>): void {
		const actionsFilePath = path.join(os.homedir(), '.agents-office', 'furniture-actions.json');
		try {
			if (!fs.existsSync(actionsFilePath)) return;
			const actionsData = JSON.parse(fs.readFileSync(actionsFilePath, 'utf-8'));
			const actionConfig = actionsData[message.uid as string] || actionsData[message.furnitureType as string];
			if (!actionConfig) return;

			if (actionConfig.type === 'openFile') {
				const filePath = (actionConfig.path as string).replace(/^~/, os.homedir());
				exec(`open "${filePath}"`);
			} else if (actionConfig.type === 'runCommand' || actionConfig.type === 'runInBackground') {
				const cmd = (actionConfig.command as string).replace(/^~/, os.homedir());
				exec(cmd, (err) => {
					if (err) console.error('[Server] furnitureAction exec error:', err);
				});
			}
		} catch (e) {
			console.error('[Server] furnitureAction error:', e);
		}
	}

	private startLayoutWatcher(): void {
		if (this.layoutWatcher) return;
		this.layoutWatcher = watchLayoutFile((layout) => {
			console.log('[Server] External layout change — broadcasting to clients');
			this.broadcaster.postMessage({ type: 'layoutLoaded', layout });
		});
	}

	dispose(): void {
		this.layoutWatcher?.dispose();
		for (const id of [...this.agents.keys()]) {
			removeAgent(
				id, this.agents, this.fileWatchers, this.pollingTimers, this.waitingTimers,
				this.permissionTimers, this.jsonlPollTimers, this.doPersist,
			);
		}
		if (this.projectScanTimer.current) {
			clearInterval(this.projectScanTimer.current);
		}
	}
}
