/**
 * Plugin: Möbel-Katalog-Panel
 *
 * Aufklappbares Seitenpanel mit allen verfügbaren Möbeln.
 * Möbel können per Drag & Drop auf den Canvas gezogen werden.
 *
 * Patch-Anleitung: Diese Datei enthält das komplette UI.
 * Bei Problemen einfach leeren oder ersetzen.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import type { FurnitureCatalogEntry, SpriteData } from '../../office/types.js'
import {
  getActiveCatalog,
  getActiveCategories,
  getCatalogByCategory,
} from '../../office/layout/furnitureCatalog.js'
import type { FurnitureCategory } from '../../office/layout/furnitureCatalog.js'
import { getCachedSprite } from '../../office/sprites/spriteCache.js'

// ── Sprite Preview Component ──────────────────────────────────

function SpritePreview({ sprite, size = 48 }: { sprite: SpriteData; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !sprite || sprite.length === 0) return

    const spriteH = sprite.length
    const spriteW = sprite[0].length

    // Calculate zoom to fit in the preview size
    const zoom = Math.max(1, Math.floor(Math.min(size / spriteW, size / spriteH)))

    canvas.width = spriteW * zoom
    canvas.height = spriteH * zoom
    canvas.style.width = `${spriteW * zoom}px`
    canvas.style.height = `${spriteH * zoom}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const cached = getCachedSprite(sprite, zoom)
    ctx.drawImage(cached, 0, 0)
  }, [sprite, size])

  return (
    <canvas
      ref={canvasRef}
      style={{ imageRendering: 'pixelated', display: 'block' }}
    />
  )
}

// ── Catalog Item ──────────────────────────────────────────────

function CatalogItem({
  entry,
  onDragStart,
}: {
  entry: FurnitureCatalogEntry
  onDragStart: (type: string, e: React.DragEvent) => void
}) {
  const [hovered, setHovered] = useState(false)

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      onDragStart(entry.type, e)
    },
    [entry.type, onDragStart],
  )

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={entry.label}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        padding: '6px 4px 4px',
        background: hovered ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
        border: '1px solid transparent',
        borderColor: hovered ? 'var(--pixel-accent)' : 'transparent',
        borderRadius: 0,
        cursor: 'grab',
        minWidth: 56,
        minHeight: 56,
        transition: 'background 0.1s',
      }}
    >
      <SpritePreview sprite={entry.sprite} size={40} />
      <span
        style={{
          fontSize: '16px',
          color: 'var(--pixel-text-dim)',
          marginTop: 3,
          textAlign: 'center',
          lineHeight: 1.1,
          maxWidth: 64,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {entry.label}
      </span>
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────

interface FurnitureCatalogPanelProps {
  isOpen: boolean
  onClose: () => void
  onDragStart: (furnitureType: string) => void
  onDragEnd: () => void
}

export function FurnitureCatalogPanel({
  isOpen,
  onClose,
  onDragStart,
  onDragEnd,
}: FurnitureCatalogPanelProps) {
  const [activeCategory, setActiveCategory] = useState<FurnitureCategory | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  const categories = getActiveCategories()
  const allItems = getActiveCatalog()

  const filteredItems = (() => {
    let items = activeCategory === 'all' ? allItems : getCatalogByCategory(activeCategory as FurnitureCategory)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      items = items.filter((e) => e.label.toLowerCase().includes(q))
    }
    return items
  })()

  const handleDragStart = useCallback(
    (type: string, e: React.DragEvent) => {
      // Set drag data (type info for the canvas drop handler)
      e.dataTransfer.setData('application/x-agents-office-furniture', type)
      e.dataTransfer.effectAllowed = 'copy'

      // Create a small drag image from the sprite
      const entry = allItems.find((i) => i.type === type)
      if (entry) {
        const zoom = 2
        const canvas = document.createElement('canvas')
        const spriteH = entry.sprite.length
        const spriteW = entry.sprite[0].length
        canvas.width = spriteW * zoom
        canvas.height = spriteH * zoom
        const ctx = canvas.getContext('2d')
        if (ctx) {
          const cached = getCachedSprite(entry.sprite, zoom)
          ctx.drawImage(cached, 0, 0)
        }
        e.dataTransfer.setDragImage(canvas, canvas.width / 2, canvas.height / 2)
      }

      onDragStart(type)
    },
    [allItems, onDragStart],
  )

  const handleDragEnd = useCallback(() => {
    onDragEnd()
  }, [onDragEnd])

  if (!isOpen) return null

  return (
    <div
      ref={panelRef}
      onDragEnd={handleDragEnd}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 50,
        width: 240,
        zIndex: 'var(--pixel-controls-z)',
        background: 'var(--pixel-bg)',
        borderLeft: '2px solid var(--pixel-border)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-2px 0 0px #0a0a14',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          borderBottom: '2px solid var(--pixel-border)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: '22px', color: 'var(--pixel-text)' }}>Furniture</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--pixel-close-text)',
            cursor: 'pointer',
            fontSize: '22px',
            padding: '2px 6px',
          }}
        >
          X
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--pixel-border)', flexShrink: 0 }}>
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '4px 8px',
            fontSize: '18px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid var(--pixel-border)',
            borderRadius: 0,
            color: 'var(--pixel-text)',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Category tabs */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 2,
          padding: '6px 6px',
          borderBottom: '1px solid var(--pixel-border)',
          flexShrink: 0,
        }}
      >
        <CategoryTab
          label="All"
          active={activeCategory === 'all'}
          onClick={() => setActiveCategory('all')}
        />
        {categories.map((cat) => (
          <CategoryTab
            key={cat.id}
            label={cat.label}
            active={activeCategory === cat.id}
            onClick={() => setActiveCategory(cat.id)}
          />
        ))}
      </div>

      {/* Items grid */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '6px',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 4,
          }}
        >
          {filteredItems.map((entry) => (
            <CatalogItem
              key={entry.type}
              entry={entry}
              onDragStart={handleDragStart}
            />
          ))}
        </div>
        {filteredItems.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--pixel-text-dim)', fontSize: '18px', padding: 20 }}>
            No items found
          </div>
        )}
      </div>
    </div>
  )
}

// ── Category Tab ──────────────────────────────────────────────

function CategoryTab({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '3px 8px',
        fontSize: '17px',
        color: active ? '#fff' : 'var(--pixel-text-dim)',
        background: active
          ? 'var(--pixel-active-bg)'
          : hovered
            ? 'var(--pixel-btn-hover-bg)'
            : 'var(--pixel-btn-bg)',
        border: active ? '1px solid var(--pixel-accent)' : '1px solid transparent',
        borderRadius: 0,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}
