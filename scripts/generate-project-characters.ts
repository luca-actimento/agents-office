/**
 * generate-project-characters.ts
 *
 * Generates 6 project-themed character sprite sheets (char_0 – char_5).
 * Each character has a distinct visual design (hair, clothing, accessories).
 *
 * Run: npx tsx scripts/generate-project-characters.ts
 *
 * Characters:
 *   0 – Developer   (dark hoodie, messy hair)       → Agents Office
 *   1 – Business    (suit, red tie, neat hair)       → Actimento Hub
 *   2 – Legal       (dark formal, long auburn hair)  → Mahnwesen
 *   3 – Inspector   (yellow helmet, orange vest)     → Röhll
 *   4 – Researcher  (lab coat, glasses)              → generic
 *   5 – Creative    (spiky purple hair, teal shirt)  → generic
 */

import * as fs from 'fs'
import * as path from 'path'
import { PNG } from 'pngjs'
import { CHARACTER_TEMPLATES } from '../webview-ui/src/office/sprites/spriteData.js'

const FRAME_W = 16
const FRAME_H = 32
const SPRITE_H = 24
const PAD_TOP = FRAME_H - SPRITE_H // 8px transparent at top of frame
const FRAMES_PER_ROW = 7

type Cell = string
type Frame = Cell[][]

// ── Low-level helpers ─────────────────────────────────────────────────────

function px(frame: Frame, r: number, c: number, color: string): void {
  if (r >= 0 && r < SPRITE_H && c >= 0 && c < FRAME_W) frame[r][c] = color
}

function fillRow(frame: Frame, r: number, cols: number[], color: string): void {
  for (const c of cols) px(frame, r, c, color)
}

/** First sprite row that contains a 'hair' key */
function hairStartRow(tmpl: readonly (readonly Cell[])[]): number {
  for (let r = 0; r < tmpl.length; r++) {
    if (tmpl[r].some(c => c === 'hair')) return r
  }
  return 1
}

/** Row containing eye pixels ('#FFFFFF') */
function eyeRowOf(tmpl: readonly (readonly Cell[])[]): number {
  for (let r = 0; r < tmpl.length; r++) {
    if (tmpl[r].some(c => c === '#FFFFFF')) return r
  }
  return -1
}

/** Resolve palette keys → actual hex colors */
function resolve(
  tmpl: readonly (readonly Cell[])[],
  c: { hair: string; skin: string; shirt: string; pants: string; shoes: string },
): Frame {
  return tmpl.map(row =>
    row.map(cell => {
      if (cell === 'hair') return c.hair
      if (cell === 'skin') return c.skin
      if (cell === 'shirt') return c.shirt
      if (cell === 'pants') return c.pants
      if (cell === 'shoes') return c.shoes
      return cell // '' (transparent) or '#FFFFFF' (eyes)
    }),
  )
}

// ── Hair shape modifiers ──────────────────────────────────────────────────

/** Extend hair 1px wider on each side (messy/big hair) */
function modHairWide(frame: Frame, tmpl: readonly (readonly Cell[])[], color: string): void {
  const hr = hairStartRow(tmpl)
  for (let r = hr; r < hr + 3 && r < SPRITE_H; r++) {
    let l = -1, ri = -1
    for (let c = 0; c < FRAME_W; c++) {
      if (frame[r][c] === color) { if (l < 0) l = c; ri = c }
    }
    if (l > 0) px(frame, r, l - 1, color)
    if (ri > 0 && ri < FRAME_W - 1) px(frame, r, ri + 1, color)
  }
}

/** Remove outermost hair pixel on each side (short/neat look) */
function modHairNarrow(frame: Frame, tmpl: readonly (readonly Cell[])[], color: string): void {
  const hr = hairStartRow(tmpl)
  for (let r = hr; r < hr + 2 && r < SPRITE_H; r++) {
    let l = -1, ri = -1
    for (let c = 0; c < FRAME_W; c++) {
      if (frame[r][c] === color) { if (l < 0) l = c; ri = c }
    }
    // Only narrow if hair is 5+ px wide (avoid making it invisible)
    if (l >= 0 && ri - l >= 4) {
      frame[r][l] = ''; frame[r][ri] = ''
    }
  }
}

/** Extend hair 1 row lower on each side (long hair) */
function modHairLong(frame: Frame, tmpl: readonly (readonly Cell[])[], color: string): void {
  const hr = hairStartRow(tmpl)
  const xr = hr + 3
  if (xr < SPRITE_H) {
    px(frame, xr, 4, color)
    px(frame, xr, 11, color)
  }
}

/** Extend hair 2px on each side + top spike (wild/spiky hair) */
function modHairSpiky(frame: Frame, tmpl: readonly (readonly Cell[])[], color: string): void {
  const hr = hairStartRow(tmpl)
  for (let r = hr; r < hr + 3 && r < SPRITE_H; r++) {
    let l = -1, ri = -1
    for (let c = 0; c < FRAME_W; c++) {
      if (frame[r][c] === color) { if (l < 0) l = c; ri = c }
    }
    const ext = r === hr ? 2 : 1
    if (l >= 0) for (let e = 1; e <= ext && l - e >= 0; e++) px(frame, r, l - e, color)
    if (ri >= 0) for (let e = 1; e <= ext && ri + e < FRAME_W; e++) px(frame, r, ri + e, color)
  }
  // Spike above hairline
  if (hr > 0) { px(frame, hr - 1, 7, color); px(frame, hr - 1, 8, color) }
}

/** Replace hair with hard-hat shape (wider, rectangular with brim) */
function modHelmet(
  frame: Frame,
  tmpl: readonly (readonly Cell[])[],
  baseColor: string,
  helmetColor: string,
): void {
  const hr = hairStartRow(tmpl)
  for (let r = hr; r < hr + 3 && r < SPRITE_H; r++) {
    // Clear existing hair pixels
    for (let c = 0; c < FRAME_W; c++) if (frame[r][c] === baseColor) frame[r][c] = ''
    if (r === hr) {
      fillRow(frame, r, [5, 6, 7, 8, 9, 10], helmetColor)        // top cap
    } else if (r === hr + 1) {
      fillRow(frame, r, [4, 5, 6, 7, 8, 9, 10, 11], helmetColor) // body
    } else {
      fillRow(frame, r, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12], helmetColor) // brim
    }
  }
}

// ── Clothing accent modifiers ─────────────────────────────────────────────

/** Add vertical tie pixels at shirt center (DOWN direction only) */
function modTie(frame: Frame, tmpl: readonly (readonly Cell[])[], tieColor: string, shirtColor: string): void {
  const ss = hairStartRow(tmpl) + 7 // shirt start row
  for (let r = ss; r < ss + 5 && r < SPRITE_H; r++) {
    if (frame[r][7] === shirtColor || frame[r][8] === shirtColor) {
      px(frame, r, 7, tieColor)
      px(frame, r, 8, tieColor)
    }
  }
}

/** Add white collar at top of shirt (DOWN direction only) */
function modCollar(frame: Frame, tmpl: readonly (readonly Cell[])[], shirtColor: string): void {
  const ss = hairStartRow(tmpl) + 7
  if (ss < SPRITE_H) {
    for (let c = 6; c <= 9; c++) {
      if (frame[ss][c] === shirtColor) px(frame, ss, c, '#EEEEEE')
    }
  }
}

/** Add simple glasses (2 side pixels at eye level, DOWN direction only) */
function modGlasses(frame: Frame, tmpl: readonly (readonly Cell[])[]): void {
  const er = eyeRowOf(tmpl)
  if (er < 0) return
  const G = '#333333'
  px(frame, er, 5, G)  // left glasses arm
  px(frame, er, 10, G) // right glasses arm
}

/** Add horizontal safety-vest stripes across shirt (all directions) */
function modVestStripes(
  frame: Frame,
  tmpl: readonly (readonly Cell[])[],
  stripeColor: string,
  shirtColor: string,
): void {
  const ss = hairStartRow(tmpl) + 7
  for (const offset of [1, 4]) {
    const r = ss + offset
    if (r >= SPRITE_H) break
    for (let c = 3; c < 13; c++) {
      if (frame[r][c] === shirtColor) px(frame, r, c, stripeColor)
    }
  }
}

// ── Character definitions ─────────────────────────────────────────────────

interface CharDef {
  name: string
  hair: string; skin: string; shirt: string; pants: string; shoes: string
  hairMod?: 'wide' | 'narrow' | 'long' | 'spiky' | 'helmet'
  helmetColor?: string
  tie?: string
  collar?: boolean
  glasses?: boolean
  vestStripes?: string
}

const CHARS: CharDef[] = [
  {
    // 0 – Developer (Agents Office): dark hoodie, messy hair, jeans, sneakers
    name: 'Developer',
    hair:  '#3D2B1F',
    skin:  '#FFCC99',
    shirt: '#484848',
    pants: '#2B3D6B',
    shoes: '#D0D0D0',
    hairMod: 'wide',
  },
  {
    // 1 – Business (Actimento Hub): dark suit, red tie, neat hair
    name: 'Business',
    hair:  '#1A1A1A',
    skin:  '#FFCC99',
    shirt: '#1C1C2E',
    pants: '#1C1C2E',
    shoes: '#111111',
    hairMod: 'narrow',
    tie:    '#CC1111',
    collar: true,
  },
  {
    // 2 – Legal (Mahnwesen): dark formal suit, long auburn hair
    name: 'Legal',
    hair:  '#8B3A1A',
    skin:  '#FDBCB4',
    shirt: '#2C2832',
    pants: '#222030',
    shoes: '#3A1A0A',
    hairMod: 'long',
  },
  {
    // 3 – Inspector (Röhll): yellow helmet, orange safety vest
    name: 'Inspector',
    hair:  '#FFD700',
    skin:  '#DEB887',
    shirt: '#FF6600',
    pants: '#1A2A44',
    shoes: '#6B3A1A',
    hairMod:     'helmet',
    helmetColor: '#FFD700',
    vestStripes: '#FFD700',
  },
  {
    // 4 – Researcher: white lab coat, glasses, neat light hair
    name: 'Researcher',
    hair:  '#B08050',
    skin:  '#FFCC99',
    shirt: '#F0F0F0',
    pants: '#555555',
    shoes: '#333333',
    glasses: true,
    collar:  true,
  },
  {
    // 5 – Creative: spiky purple hair, teal shirt, olive pants, orange shoes
    name: 'Creative',
    hair:  '#6633BB',
    skin:  '#DEB887',
    shirt: '#00AAAA',
    pants: '#556633',
    shoes: '#CC6600',
    hairMod: 'spiky',
  },
  {
    // 6 – Actimento: charcoal suit, gold tie, light hair — Actimento CI (#F9A704 gold, #252525 charcoal)
    name: 'Actimento',
    hair:  '#C8A86B',
    skin:  '#FFCC99',
    shirt: '#252525',
    pants: '#252525',
    shoes: '#F9A704',
    hairMod: 'narrow',
    tie:    '#F9A704',
    collar: true,
  },
]

// ── PNG generation ────────────────────────────────────────────────────────

function generateChar(def: CharDef): Buffer {
  const width  = FRAME_W * FRAMES_PER_ROW // 112
  const height = FRAME_H * 3              // 96
  const png = new PNG({ width, height })

  const dirs      = ['down', 'up', 'right'] as const
  const frameSets = [
    CHARACTER_TEMPLATES.down,
    CHARACTER_TEMPLATES.up,
    CHARACTER_TEMPLATES.right,
  ] as const

  for (let di = 0; di < 3; di++) {
    const dir   = dirs[di]
    const fset  = frameSets[di] as readonly (readonly (readonly Cell[])[])[]

    for (let fi = 0; fi < FRAMES_PER_ROW; fi++) {
      const tmpl = fset[fi] as readonly (readonly Cell[])[]
      const frame = resolve(tmpl, def)

      // ── Hair mods ──
      if      (def.hairMod === 'wide')    modHairWide(frame, tmpl, def.hair)
      else if (def.hairMod === 'narrow')  modHairNarrow(frame, tmpl, def.hair)
      else if (def.hairMod === 'long')    modHairLong(frame, tmpl, def.hair)
      else if (def.hairMod === 'spiky')   modHairSpiky(frame, tmpl, def.hair)
      else if (def.hairMod === 'helmet' && def.helmetColor)
        modHelmet(frame, tmpl, def.hair, def.helmetColor)

      // ── Clothing accents (DOWN only for face/front features) ──
      if (dir === 'down') {
        if (def.tie)     modTie(frame, tmpl, def.tie, def.shirt)
        if (def.collar)  modCollar(frame, tmpl, def.shirt)
        if (def.glasses) modGlasses(frame, tmpl)
      }
      // Vest stripes visible from all directions
      if (def.vestStripes) modVestStripes(frame, tmpl, def.vestStripes, def.shirt)

      // ── Write pixels to PNG ──
      for (let y = 0; y < SPRITE_H; y++) {
        for (let x = 0; x < FRAME_W; x++) {
          const color = frame[y][x]
          const pixX  = fi * FRAME_W + x
          const pixY  = di * FRAME_H + PAD_TOP + y
          const idx   = (pixY * width + pixX) * 4

          if (!color) {
            png.data[idx] = png.data[idx + 1] = png.data[idx + 2] = png.data[idx + 3] = 0
          } else {
            png.data[idx]     = parseInt(color.slice(1, 3), 16)
            png.data[idx + 1] = parseInt(color.slice(3, 5), 16)
            png.data[idx + 2] = parseInt(color.slice(5, 7), 16)
            png.data[idx + 3] = 255
          }
        }
      }
    }
  }

  return PNG.sync.write(png)
}

// ── Main ──────────────────────────────────────────────────────────────────

const outDir = path.resolve(process.cwd(), 'webview-ui/public/assets/characters')

console.log('Generating project character sprites...\n')

for (let i = 0; i < CHARS.length; i++) {
  const def = CHARS[i]
  process.stdout.write(`  char_${i}.png  ${def.name.padEnd(12)} ... `)
  const buf = generateChar(def)
  fs.writeFileSync(path.join(outDir, `char_${i}.png`), buf)
  console.log('✓')
}

console.log(`\nDone. ${CHARS.length} sprites written to:\n  ${outDir}`)
