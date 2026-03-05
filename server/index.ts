import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { AgentServer } from './agentServer.js';
import { SERVER_PORT } from './constants.js';

// In CJS bundles (esbuild) import.meta.url is undefined — banner injects __cjsBundleFilename
const __dirname = (globalThis as { __cjsBundleFilename?: string }).__cjsBundleFilename
	? path.dirname((globalThis as { __cjsBundleFilename: string }).__cjsBundleFilename)
	: path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? parseInt(process.env.PORT) : SERVER_PORT;

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// If running from dist/server/ (CJS bundle), webview is one level up at dist/webview/
// If running from server/ (dev via tsx), webview is at ../dist/webview/
const webviewDist = __dirname.includes(`${path.sep}dist${path.sep}server`)
	? path.resolve(__dirname, '../webview')
	: path.resolve(__dirname, '../dist/webview');

// Permissive CSP for browser mode: allow blob: URLs needed by xterm.js Web Workers
app.use((_req, res, next) => {
	res.setHeader('Content-Security-Policy',
		"default-src 'self'; script-src 'self' 'unsafe-inline' blob:; worker-src blob: 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://localhost:* wss://localhost:*; font-src 'self' data:");
	next();
});
app.use(express.static(webviewDist));

// SPA fallback for client-side routing
app.get('*', (_req, res) => {
	res.sendFile(path.join(webviewDist, 'index.html'));
});

const agentServer = new AgentServer();

wss.on('connection', (ws: WebSocket) => {
	agentServer.addClient(ws);

	ws.on('message', (data) => {
		try {
			const msg = JSON.parse(data.toString()) as Record<string, unknown>;
			agentServer.handleMessage(ws, msg).catch(console.error);
		} catch (e) {
			console.error('[Server] Invalid message:', e);
		}
	});

	ws.on('close', () => {
		agentServer.removeClient(ws);
	});

	ws.on('error', (err) => {
		console.error('[Server] WebSocket error:', err);
		agentServer.removeClient(ws);
	});
});

server.listen(PORT, () => {
	console.log(`[Agents Office] Browser server running at http://localhost:${PORT}`);
	console.log(`[Agents Office] Press Ctrl+C to stop`);
});

process.on('SIGINT', () => {
	console.log('\n[Server] Shutting down...');
	agentServer.dispose();
	process.exit(0);
});
