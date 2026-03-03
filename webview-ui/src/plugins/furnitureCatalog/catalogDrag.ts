/**
 * Plugin: Catalog Drag Handler
 *
 * Verarbeitet das Drag & Drop von Möbeln aus dem Katalog-Panel
 * auf den Canvas. Erzeugt Ghost-Previews und platziert Möbel.
 *
 * Patch-Anleitung: Separate Datei für die Drop-Logik.
 */

import type { OfficeState } from '../../office/engine/officeState.js'
import type { PlacedFurniture } from '../../office/types.js'
import { getCatalogEntry } from '../../office/layout/furnitureCatalog.js'
import { canPlaceFurniture, placeFurniture, getWallPlacementRow } from '../../office/editor/editorActions.js'
import { vscode } from '../../vscodeApi.js'
import { LAYOUT_SAVE_DEBOUNCE_MS } from '../../constants.js'
import type { CatalogDragState, PluginGhostState } from '../types.js'

// ── State ────────────────────────────────────────────────────

const state: CatalogDragState = {
  furnitureType: null,
  ghostCol: -1,
  ghostRow: -1,
  ghostValid: false,
  overCanvas: false,
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

function debouncedSave(layout: import('../../office/types.js').OfficeLayout): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    vscode.postMessage({ type: 'saveLayout', layout })
  }, LAYOUT_SAVE_DEBOUNCE_MS)
}

// ── Public API ───────────────────────────────────────────────

export function isActive(): boolean {
  return state.furnitureType !== null
}

export function startDrag(furnitureType: string): void {
  state.furnitureType = furnitureType
  state.ghostCol = -1
  state.ghostRow = -1
  state.ghostValid = false
  state.overCanvas = false
}

export function endDrag(): void {
  state.furnitureType = null
  state.ghostCol = -1
  state.ghostRow = -1
  state.ghostValid = false
  state.overCanvas = false
}

export function updateGhost(officeState: OfficeState, tileCol: number, tileRow: number): void {
  if (!state.furnitureType) return

  state.overCanvas = true
  const placementRow = getWallPlacementRow(state.furnitureType, tileRow)
  state.ghostCol = tileCol
  state.ghostRow = placementRow
  state.ghostValid = canPlaceFurniture(officeState.getLayout(), state.furnitureType, tileCol, placementRow)
}

export function leaveCanvas(): void {
  state.overCanvas = false
  state.ghostCol = -1
  state.ghostRow = -1
}

/** Get ghost preview for the renderer. */
export function getGhostState(): PluginGhostState | null {
  if (!state.furnitureType || !state.overCanvas || state.ghostCol < 0) return null

  const entry = getCatalogEntry(state.furnitureType)
  if (!entry) return null

  return {
    sprite: entry.sprite,
    col: state.ghostCol,
    row: state.ghostRow,
    valid: state.ghostValid,
  }
}

/**
 * Handle drop on canvas. Places the furniture if valid.
 * Returns true if furniture was placed.
 */
export function handleDrop(officeState: OfficeState, tileCol: number, tileRow: number): boolean {
  if (!state.furnitureType) return false

  const type = state.furnitureType
  const placementRow = getWallPlacementRow(type, tileRow)

  const layout = officeState.getLayout()
  if (!canPlaceFurniture(layout, type, tileCol, placementRow)) {
    endDrag()
    return false
  }

  const uid = `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const placed: PlacedFurniture = { uid, type, col: tileCol, row: placementRow }

  const newLayout = placeFurniture(layout, placed)
  if (newLayout !== layout) {
    officeState.rebuildFromLayout(newLayout)
    debouncedSave(newLayout)
  }

  endDrag()
  return true
}
