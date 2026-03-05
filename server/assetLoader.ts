// Standalone asset loader for the browser server — no vscode dependencies
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import {
	PNG_ALPHA_THRESHOLD, WALL_PIECE_WIDTH, WALL_PIECE_HEIGHT, WALL_GRID_COLS, WALL_BITMASK_COUNT,
	FLOOR_PATTERN_COUNT, FLOOR_TILE_SIZE, CHARACTER_DIRECTIONS, CHAR_FRAME_W, CHAR_FRAME_H,
	CHAR_FRAMES_PER_ROW, CHAR_COUNT,
} from './constants.js';

export interface FurnitureAsset {
	id: string; name: string; label: string; category: string; file: string;
	width: number; height: number; footprintW: number; footprintH: number;
	isDesk: boolean; canPlaceOnWalls: boolean;
	partOfGroup?: boolean; groupId?: string; canPlaceOnSurfaces?: boolean;
	backgroundTiles?: number; orientation?: string; state?: string;
}

export interface LoadedAssets {
	catalog: FurnitureAsset[];
	sprites: Map<string, string[][]>;
}

function pngToSpriteData(pngBuffer: Buffer, width: number, height: number): string[][] {
	try {
		const png = PNG.sync.read(pngBuffer);
		const sprite: string[][] = [];
		for (let y = 0; y < height; y++) {
			const row: string[] = [];
			for (let x = 0; x < width; x++) {
				const i = (y * png.width + x) * 4;
				const a = png.data[i + 3];
				if (a < PNG_ALPHA_THRESHOLD) { row.push(''); continue; }
				const r = png.data[i].toString(16).padStart(2, '0');
				const g = png.data[i + 1].toString(16).padStart(2, '0');
				const b = png.data[i + 2].toString(16).padStart(2, '0');
				row.push(`#${r}${g}${b}`.toUpperCase());
			}
			sprite.push(row);
		}
		return sprite;
	} catch {
		return Array.from({ length: height }, () => new Array(width).fill(''));
	}
}

export async function loadFurnitureAssets(assetsRoot: string): Promise<LoadedAssets | null> {
	try {
		const catalogPath = path.join(assetsRoot, 'assets', 'furniture', 'furniture-catalog.json');
		if (!fs.existsSync(catalogPath)) return null;
		const catalog: FurnitureAsset[] = (JSON.parse(fs.readFileSync(catalogPath, 'utf-8')) as { assets?: FurnitureAsset[] }).assets || [];
		const sprites = new Map<string, string[][]>();
		for (const asset of catalog) {
			try {
				let filePath = asset.file;
				if (!filePath.startsWith('assets/')) filePath = `assets/${filePath}`;
				const assetPath = path.join(assetsRoot, filePath);
				if (!fs.existsSync(assetPath)) continue;
				sprites.set(asset.id, pngToSpriteData(fs.readFileSync(assetPath), asset.width, asset.height));
			} catch { /* skip */ }
		}
		console.log(`[AssetLoader] Loaded ${sprites.size}/${catalog.length} furniture sprites`);
		return { catalog, sprites };
	} catch (err) {
		console.error('[AssetLoader] Error loading furniture:', err);
		return null;
	}
}

export function loadDefaultLayout(assetsRoot: string): Record<string, unknown> | null {
	try {
		const p = path.join(assetsRoot, 'assets', 'default-layout.json');
		if (!fs.existsSync(p)) return null;
		return JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;
	} catch { return null; }
}

export async function loadWallTiles(assetsRoot: string): Promise<{ sprites: string[][][] } | null> {
	try {
		const wallPath = path.join(assetsRoot, 'assets', 'walls.png');
		if (!fs.existsSync(wallPath)) return null;
		const png = PNG.sync.read(fs.readFileSync(wallPath));
		const sprites: string[][][] = [];
		for (let mask = 0; mask < WALL_BITMASK_COUNT; mask++) {
			const ox = (mask % WALL_GRID_COLS) * WALL_PIECE_WIDTH;
			const oy = Math.floor(mask / WALL_GRID_COLS) * WALL_PIECE_HEIGHT;
			const sprite: string[][] = [];
			for (let r = 0; r < WALL_PIECE_HEIGHT; r++) {
				const row: string[] = [];
				for (let c = 0; c < WALL_PIECE_WIDTH; c++) {
					const idx = ((oy + r) * png.width + (ox + c)) * 4;
					if (png.data[idx + 3] < PNG_ALPHA_THRESHOLD) { row.push(''); continue; }
					row.push(`#${png.data[idx].toString(16).padStart(2, '0')}${png.data[idx + 1].toString(16).padStart(2, '0')}${png.data[idx + 2].toString(16).padStart(2, '0')}`.toUpperCase());
				}
				sprite.push(row);
			}
			sprites.push(sprite);
		}
		return { sprites };
	} catch { return null; }
}

export async function loadFloorTiles(assetsRoot: string): Promise<{ sprites: string[][][] } | null> {
	try {
		const floorPath = path.join(assetsRoot, 'assets', 'floors.png');
		if (!fs.existsSync(floorPath)) return null;
		const png = PNG.sync.read(fs.readFileSync(floorPath));
		const sprites: string[][][] = [];
		for (let t = 0; t < FLOOR_PATTERN_COUNT; t++) {
			const sprite: string[][] = [];
			for (let y = 0; y < FLOOR_TILE_SIZE; y++) {
				const row: string[] = [];
				for (let x = 0; x < FLOOR_TILE_SIZE; x++) {
					const px = t * FLOOR_TILE_SIZE + x;
					const idx = (y * png.width + px) * 4;
					if (png.data[idx + 3] < PNG_ALPHA_THRESHOLD) { row.push(''); continue; }
					row.push(`#${png.data[idx].toString(16).padStart(2, '0')}${png.data[idx + 1].toString(16).padStart(2, '0')}${png.data[idx + 2].toString(16).padStart(2, '0')}`.toUpperCase());
				}
				sprite.push(row);
			}
			sprites.push(sprite);
		}
		return { sprites };
	} catch { return null; }
}

export async function loadCharacterSprites(assetsRoot: string): Promise<{ characters: Array<{ down: string[][][]; up: string[][][]; right: string[][][] }> } | null> {
	try {
		const charDir = path.join(assetsRoot, 'assets', 'characters');
		const characters: Array<{ down: string[][][]; up: string[][][]; right: string[][][] }> = [];
		for (let ci = 0; ci < CHAR_COUNT; ci++) {
			const filePath = path.join(charDir, `char_${ci}.png`);
			if (!fs.existsSync(filePath)) return null;
			const png = PNG.sync.read(fs.readFileSync(filePath));
			const charData = { down: [] as string[][][], up: [] as string[][][], right: [] as string[][][] };
			for (let dirIdx = 0; dirIdx < CHARACTER_DIRECTIONS.length; dirIdx++) {
				const dir = CHARACTER_DIRECTIONS[dirIdx];
				const rowOffsetY = dirIdx * CHAR_FRAME_H;
				const frames: string[][][] = [];
				for (let f = 0; f < CHAR_FRAMES_PER_ROW; f++) {
					const sprite: string[][] = [];
					const frameOffsetX = f * CHAR_FRAME_W;
					for (let y = 0; y < CHAR_FRAME_H; y++) {
						const row: string[] = [];
						for (let x = 0; x < CHAR_FRAME_W; x++) {
							const idx = ((rowOffsetY + y) * png.width + (frameOffsetX + x)) * 4;
							if (png.data[idx + 3] < PNG_ALPHA_THRESHOLD) { row.push(''); continue; }
							row.push(`#${png.data[idx].toString(16).padStart(2, '0')}${png.data[idx + 1].toString(16).padStart(2, '0')}${png.data[idx + 2].toString(16).padStart(2, '0')}`.toUpperCase());
						}
						sprite.push(row);
					}
					frames.push(sprite);
				}
				charData[dir] = frames;
			}
			characters.push(charData);
		}
		return { characters };
	} catch { return null; }
}
