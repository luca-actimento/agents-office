const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Copy assets folder to dist/assets
 */
function copyAssets() {
	const srcDir = path.join(__dirname, 'webview-ui', 'public', 'assets');
	const dstDir = path.join(__dirname, 'dist', 'assets');

	if (fs.existsSync(srcDir)) {
		// Remove existing dist/assets if present
		if (fs.existsSync(dstDir)) {
			fs.rmSync(dstDir, { recursive: true });
		}

		// Copy recursively
		fs.cpSync(srcDir, dstDir, { recursive: true });
		console.log('✓ Copied assets/ → dist/assets/');
	} else {
		console.log('ℹ️  assets/ folder not found (optional)');
	}
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

/**
 * Copy node-pty from server/node_modules to dist/server/node_modules
 * (node-pty has native bindings and cannot be bundled)
 */
function copyNodePty() {
	const src = path.join(__dirname, 'server', 'node_modules', 'node-pty');
	const dst = path.join(__dirname, 'dist', 'server', 'node_modules', 'node-pty');
	if (!fs.existsSync(src)) {
		console.log('ℹ️  server/node_modules/node-pty not found (run: npm install --prefix server)');
		return;
	}
	if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true });
	fs.mkdirSync(path.dirname(dst), { recursive: true });
	fs.cpSync(src, dst, { recursive: true });
	// Ensure spawn-helper binaries have execute permissions (npm may strip them)
	const prebuildsDir = path.join(dst, 'prebuilds');
	if (fs.existsSync(prebuildsDir)) {
		for (const platform of fs.readdirSync(prebuildsDir)) {
			const helper = path.join(prebuildsDir, platform, 'spawn-helper');
			if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
		}
	}
	console.log('✓ Copied node-pty → dist/server/node_modules/node-pty');
}

async function buildServer() {
	const result = await esbuild.build({
		entryPoints: ['server/index.ts'],
		bundle: true,
		format: 'cjs',
		platform: 'node',
		outfile: 'dist/server/index.cjs',
		external: ['node-pty'],
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		logLevel: 'silent',
		// Capture __filename at the top of the CJS wrapper (before any import.meta.url usage)
		// so the source code can fall back to it when import.meta.url is undefined in CJS.
		banner: { js: 'globalThis.__cjsBundleFilename = __filename;' },
	});
	if (result.errors.length) {
		result.errors.forEach(({ text, location }) => {
			console.error(`✘ [SERVER] ${text}`);
			if (location) console.error(`    ${location.file}:${location.line}:${location.column}`);
		});
	} else {
		console.log('✓ Built server → dist/server/index.cjs');
	}
	copyNodePty();
}

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
		// Copy assets after build
		copyAssets();
		// Bundle the standalone browser server
		await buildServer();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
