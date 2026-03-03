import type { OfficeState } from '../office/engine/officeState.js'
import type { SpriteData, OfficeLayout } from '../office/types.js'

/** Ghost preview state for plugins to render drag previews on the canvas. */
export interface PluginGhostState {
  sprite: SpriteData
  col: number
  row: number
  valid: boolean
}

/** Drag state managed by the drag-drop plugin. */
export interface DragDropState {
  /** UID of furniture being dragged (null = no drag) */
  dragUid: string | null
  /** Whether mouse has moved enough to start visual drag */
  isDragMoving: boolean
  /** Ghost preview col (tile coord) */
  ghostCol: number
  /** Ghost preview row (tile coord) */
  ghostRow: number
  /** Offset from furniture top-left to click position */
  dragOffsetCol: number
  dragOffsetRow: number
  /** Starting tile position of drag */
  dragStartCol: number
  dragStartRow: number
}

/** Catalog drag state when dragging from catalog panel to canvas. */
export interface CatalogDragState {
  /** Furniture type being dragged from catalog */
  furnitureType: string | null
  /** Ghost preview col */
  ghostCol: number
  /** Ghost preview row */
  ghostRow: number
  /** Whether current position is valid for placement */
  ghostValid: boolean
  /** Whether the drag has entered the canvas */
  overCanvas: boolean
}

/** Callback to save layout changes (debounced). */
export type SaveLayoutFn = (layout: OfficeLayout) => void

/** Callback to get current office state. */
export type GetOfficeStateFn = () => OfficeState

/** Callback to notify React of changes (increment editor tick). */
export type NotifyChangeFn = () => void
