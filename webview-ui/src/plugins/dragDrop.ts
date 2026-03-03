/**
 * Plugin: Drag & Drop im Normal-Modus
 *
 * Ermöglicht das Verschieben von Möbeln per Drag & Drop,
 * ohne den Edit-Modus aktivieren zu müssen.
 *
 * Patch-Anleitung: Diese Datei enthält die gesamte Drag-Logik.
 * Bei Problemen einfach diese Datei ersetzen oder leeren.
 */

import type { OfficeState } from '../office/engine/officeState.js'
import type { PlacedFurniture } from '../office/types.js'
import { getCatalogEntry } from '../office/layout/furnitureCatalog.js'
import { canPlaceFurniture, moveFurniture, removeFurniture } from '../office/editor/editorActions.js'
import { vscode } from '../vscodeApi.js'
import { LAYOUT_SAVE_DEBOUNCE_MS } from '../constants.js'
import type { DragDropState, PluginGhostState } from './types.js'

// ── State ────────────────────────────────────────────────────

const state: DragDropState = {
  dragUid: null,
  isDragMoving: false,
  ghostCol: -1,
  ghostRow: -1,
  dragOffsetCol: 0,
  dragOffsetRow: 0,
  dragStartCol: 0,
  dragStartRow: 0,
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

function debouncedSave(layout: import('../office/types.js').OfficeLayout): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    vscode.postMessage({ type: 'saveLayout', layout })
  }, LAYOUT_SAVE_DEBOUNCE_MS)
}

// ── Public API ───────────────────────────────────────────────

export function isDragging(): boolean {
  return state.dragUid !== null
}

export function isDragMoving(): boolean {
  return state.isDragMoving
}

export function getDragUid(): string | null {
  return state.dragUid
}

/** Get ghost preview state for renderer (null = no preview). */
export function getGhostState(officeState: OfficeState): PluginGhostState | null {
  if (!state.isDragMoving || !state.dragUid || state.ghostCol < 0) return null

  const layout = officeState.getLayout()
  const draggedItem = layout.furniture.find((f) => f.uid === state.dragUid)
  if (!draggedItem) return null

  const entry = getCatalogEntry(draggedItem.type)
  if (!entry) return null

  const col = state.ghostCol - state.dragOffsetCol
  const row = state.ghostRow - state.dragOffsetRow
  const valid = canPlaceFurniture(layout, draggedItem.type, col, row, state.dragUid)

  return { sprite: entry.sprite, col, row, valid }
}

/**
 * Handle mousedown in normal mode.
 * Returns true if a furniture drag was started (caller should skip default handling).
 */
export function handleMouseDown(
  officeState: OfficeState,
  tileCol: number,
  tileRow: number,
): boolean {
  const layout = officeState.getLayout()

  // Find furniture at clicked tile (prefer surface items on top)
  let hitFurniture: PlacedFurniture | null = null
  for (const f of layout.furniture) {
    const entry = getCatalogEntry(f.type)
    if (!entry) continue
    if (
      tileCol >= f.col && tileCol < f.col + entry.footprintW &&
      tileRow >= f.row && tileRow < f.row + entry.footprintH
    ) {
      if (!hitFurniture || entry.canPlaceOnSurfaces) hitFurniture = f
    }
  }

  if (!hitFurniture) return false

  // Start drag
  state.dragUid = hitFurniture.uid
  state.dragStartCol = tileCol
  state.dragStartRow = tileRow
  state.dragOffsetCol = tileCol - hitFurniture.col
  state.dragOffsetRow = tileRow - hitFurniture.row
  state.isDragMoving = false
  state.ghostCol = tileCol
  state.ghostRow = tileRow

  return true
}

/**
 * Handle mousemove during drag.
 * Returns true if event was consumed.
 */
export function handleMouseMove(tileCol: number, tileRow: number): boolean {
  if (!state.dragUid) return false

  state.ghostCol = tileCol
  state.ghostRow = tileRow

  // Check if moved to a different tile to start visual drag
  if (!state.isDragMoving) {
    if (tileCol !== state.dragStartCol || tileRow !== state.dragStartRow) {
      state.isDragMoving = true
    }
  }

  return true
}

/**
 * Handle mouseup to complete or cancel drag.
 * Returns true if a drag was in progress.
 */
export function handleMouseUp(officeState: OfficeState): boolean {
  if (!state.dragUid) return false

  if (state.isDragMoving) {
    const col = state.ghostCol - state.dragOffsetCol
    const row = state.ghostRow - state.dragOffsetRow
    const layout = officeState.getLayout()
    const draggedItem = layout.furniture.find((f) => f.uid === state.dragUid)

    if (draggedItem) {
      // Prüfe ob Drop-Position außerhalb des Grids → Möbel aufnehmen (entfernen)
      if (col < 0 || row < 0 || col >= layout.cols || row >= layout.rows) {
        const newLayout = removeFurniture(layout, state.dragUid!)
        if (newLayout !== layout) {
          officeState.rebuildFromLayout(newLayout)
          debouncedSave(newLayout)
        }
      } else {
        const valid = canPlaceFurniture(layout, draggedItem.type, col, row, state.dragUid)
        if (valid) {
          const newLayout = moveFurniture(layout, state.dragUid!, col, row)
          if (newLayout !== layout) {
            officeState.rebuildFromLayout(newLayout)
            debouncedSave(newLayout)
          }
        }
      }
    }
  }

  clearDrag()
  return true
}

/**
 * Handle mouse leave — wenn Drag aktiv, Möbel aufnehmen (entfernen).
 * Gibt OfficeState zurück falls übergeben, damit der Aufrufer reagieren kann.
 */
export function handleMouseLeave(officeState?: OfficeState): void {
  if (state.isDragMoving && state.dragUid && officeState) {
    // Möbel aus dem Grid gezogen → entfernen
    const layout = officeState.getLayout()
    const newLayout = removeFurniture(layout, state.dragUid)
    if (newLayout !== layout) {
      officeState.rebuildFromLayout(newLayout)
      debouncedSave(newLayout)
    }
  }
  clearDrag()
}

/** Get cursor for current drag state. */
export function getCursor(
  officeState: OfficeState,
  tileCol: number,
  tileRow: number,
): string | null {
  if (state.isDragMoving) return 'grabbing'
  if (state.dragUid) return 'grab'

  // Check if hovering over furniture
  const layout = officeState.getLayout()
  for (const f of layout.furniture) {
    const entry = getCatalogEntry(f.type)
    if (!entry) continue
    if (
      tileCol >= f.col && tileCol < f.col + entry.footprintW &&
      tileRow >= f.row && tileRow < f.row + entry.footprintH
    ) {
      return 'grab'
    }
  }

  return null
}

function clearDrag(): void {
  state.dragUid = null
  state.isDragMoving = false
  state.ghostCol = -1
  state.ghostRow = -1
}
