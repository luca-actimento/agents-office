import { TILE_SIZE, MATRIX_EFFECT_DURATION, CharacterState, Direction } from '../types.js'
import {
  PALETTE_COUNT,
  HUE_SHIFT_MIN_DEG,
  HUE_SHIFT_RANGE_DEG,
  WAITING_BUBBLE_DURATION_SEC,
  DISMISS_BUBBLE_FAST_FADE_SEC,
  INACTIVE_SEAT_TIMER_MIN_SEC,
  INACTIVE_SEAT_TIMER_RANGE_SEC,
  TURN_END_GRACE_SEC,
  AUTO_ON_FACING_DEPTH,
  AUTO_ON_SIDE_DEPTH,
  CHARACTER_SITTING_OFFSET_PX,
  CHARACTER_HIT_HALF_WIDTH,
  CHARACTER_HIT_HEIGHT,
  CAFE_BREW_DURATION_SEC,
  CHEFZIMMER_BUTTON_COL,
  CHEFZIMMER_BUTTON_ROW,
} from '../../constants.js'
import type { Character, Seat, FurnitureInstance, TileType as TileTypeVal, OfficeLayout, PlacedFurniture } from '../types.js'

const MASCOT_BUBBLE_DURATION_SEC = 8.0

const MASCOT_MESSAGES = [
  'Alles unter Kontrolle! 👌',
  'Tippe, tippe, tippe...',
  'Noch 5 Minuten, versprochen.',
  'Das steht so in keinem Handbuch.',
  'Ich lerne noch. 🤓',
  'Context Window: fast voll.',
  'Halluziniere ich gerade? Nein.',
  'Kaffee wäre jetzt nice.',
  'Hm, interessanter Prompt.',
  'Arbeite hart. Oder klug. Beides.',
  '99 Probleme, aber ein Bug ist keins.',
  'Läuft bei mir! (lokal)',
  'Das war so gewollt.',
  'Manche nennen es Bug, ich: Feature.',
  'Sag mal... hörst du das auch?',
  'Bitte nicht unterbrechen, ich denke.',
  'Stack Overflow hat auch nichts.',
  'Hab ich schon mal gemacht. Fast.',
  'Deadline? Kenn ich nicht.',
  'Das ist kein Bug, das ist Jazz.',
  'Wer hat an meinen Tokens gedreht?',
  'Gerade 3 Tabs offen. Rekord.',
  'Ich bin offiziell im Flow.',
  'Einfach mal committen und schauen.',
  'Laut Doku sollte das funktionieren.',
  'Fehler 404: Motivation not found.',
  'Hab den Fix. Bin gleich zurück.',
  'Manchmal träume ich in JSON.',
  'Wer braucht schon Schlaf.',
  'Update: es war doch der Cache.',
  'Ich bin kein Roboter. Meistens.',
  'Das reviewt sich nicht selbst.',
  'Attention is all you need. Auch Kaffee.',
  'Wo ist eigentlich der Papierkram?',
  'Nur noch eine Funktion.',
]
import { createCharacter, updateCharacter } from './characters.js'
import { matrixEffectSeeds } from './matrixEffect.js'
import { isWalkable, getWalkableTiles, findPath } from '../layout/tileMap.js'
import {
  createDefaultLayout,
  layoutToTileMap,
  layoutToFurnitureInstances,
  layoutToSeats,
  getBlockedTiles,
} from '../layout/layoutSerializer.js'
import { getCatalogEntry, getOnStateType, getToggledType, isDoor, isOpenDoor } from '../layout/furnitureCatalog.js'
import { playDoorSound } from '../../notificationSound.js'

export class OfficeState {
  layout: OfficeLayout
  tileMap: TileTypeVal[][]
  seats: Map<string, Seat>
  blockedTiles: Set<string>
  furniture: FurnitureInstance[]
  walkableTiles: Array<{ col: number; row: number }>
  private cafeWalkableTiles: Array<{ col: number; row: number }> = []
  private mascotWalkableTiles: Array<{ col: number; row: number }> = []
  private mascotBlockedTiles: Set<string> = new Set()
  private cafeSeatIds: string[] = []
  characters: Map<number, Character> = new Map()
  selectedAgentId: number | null = null
  cameraFollowId: number | null = null
  hoveredAgentId: number | null = null
  hoveredTile: { col: number; row: number } | null = null
  /** Maps "parentId:toolId" → sub-agent character ID (negative) */
  subagentIdMap: Map<string, number> = new Map()
  /** Reverse lookup: sub-agent character ID → parent info */
  subagentMeta: Map<number, { parentAgentId: number; parentToolId: string }> = new Map()
  private nextSubagentId = -1

  // ── Static mascot NPCs ──────────────────────────────────────────────────
  static readonly MASCOT_ACTIMENTO_ID = -999

  /** Mascot config: each entry defines a permanent NPC in the office */
  static readonly MASCOTS = [
    { id: OfficeState.MASCOT_ACTIMENTO_ID, palette: 6, col: 18, row: 4, dir: Direction.DOWN, label: 'Actimento' },
  ] as const

  constructor(layout?: OfficeLayout) {
    this.layout = layout || createDefaultLayout()
    this.tileMap = layoutToTileMap(this.layout)
    this.seats = layoutToSeats(this.layout.furniture)
    this.blockedTiles = getBlockedTiles(this.layout.furniture)
    this.furniture = layoutToFurnitureInstances(this.layout.furniture)
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles)
    this.cafeWalkableTiles = this.buildCafeWalkableTiles()
    this.mascotWalkableTiles = this.buildMascotWalkableTiles()
    this.mascotBlockedTiles = this.buildMascotBlockedTiles()
    this.cafeSeatIds = this.buildCafeSeatIds()
    this.initMascots()
  }

  /** Place permanent mascot NPCs into the office. Safe to call multiple times. */
  private initMascots(): void {
    for (const m of OfficeState.MASCOTS) {
      if (this.characters.has(m.id)) continue
      const ch = createCharacter(m.id, m.palette, null, null, 0)

      // Spawn in the mascot wander zone (bottom-right), fall back to any walkable tile
      const spawnPool = this.mascotWalkableTiles.length >= 4
        ? this.mascotWalkableTiles
        : (this.walkableTiles.length > 0 ? this.walkableTiles : null)
      const spawn = spawnPool
        ? spawnPool[Math.floor(Math.random() * spawnPool.length)]
        : { col: m.col, row: m.row }

      ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2
      ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2
      ch.tileCol = spawn.col
      ch.tileRow = spawn.row
      ch.dir = m.dir
      ch.state = CharacterState.IDLE
      ch.isActive = false
      ch.isMascot = true
      ch.folderName = m.label
      ch.wanderTimer = 1 + Math.random() * 3
      // cafeBrewTimer repurposed as bubble cooldown for mascots
      ch.cafeBrewTimer = 5 + Math.random() * 10
      this.characters.set(m.id, ch)
    }
  }

  /** Rebuild all derived state from a new layout. Reassigns existing characters.
   *  @param shift Optional pixel shift to apply when grid expands left/up */
  rebuildFromLayout(layout: OfficeLayout, shift?: { col: number; row: number }): void {
    this.layout = layout
    this.tileMap = layoutToTileMap(layout)
    this.seats = layoutToSeats(layout.furniture)
    this.blockedTiles = getBlockedTiles(layout.furniture)
    this.rebuildFurnitureInstances()
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles)
    this.cafeWalkableTiles = this.buildCafeWalkableTiles()
    this.mascotWalkableTiles = this.buildMascotWalkableTiles()
    this.mascotBlockedTiles = this.buildMascotBlockedTiles()
    this.cafeSeatIds = this.buildCafeSeatIds()

    // Shift character positions when grid expands left/up
    if (shift && (shift.col !== 0 || shift.row !== 0)) {
      for (const ch of this.characters.values()) {
        ch.tileCol += shift.col
        ch.tileRow += shift.row
        ch.x += shift.col * TILE_SIZE
        ch.y += shift.row * TILE_SIZE
        // Clear path since tile coords changed
        ch.path = []
        ch.moveProgress = 0
      }
    }

    // Reassign characters to new seats, preserving existing assignments when possible
    for (const seat of this.seats.values()) {
      seat.assigned = false
    }

    // Re-position mascots into the (now updated) wander zone
    for (const ch of this.characters.values()) {
      if (!ch.isMascot) continue
      const pool = this.mascotWalkableTiles.length >= 4 ? this.mascotWalkableTiles : this.walkableTiles
      if (pool.length === 0) continue
      const spawn = pool[Math.floor(Math.random() * pool.length)]
      ch.tileCol = spawn.col
      ch.tileRow = spawn.row
      ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2
      ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2
      ch.path = []
      ch.moveProgress = 0
    }

    // First pass: try to keep characters at their existing seats (skip mascots)
    for (const ch of this.characters.values()) {
      if (ch.isMascot) continue // mascots have fixed positions, not seats
      if (ch.seatId && this.seats.has(ch.seatId)) {
        const seat = this.seats.get(ch.seatId)!
        if (!seat.assigned) {
          seat.assigned = true
          // Snap character to seat position
          ch.tileCol = seat.seatCol
          ch.tileRow = seat.seatRow
          const cx = seat.seatCol * TILE_SIZE + TILE_SIZE / 2
          const cy = seat.seatRow * TILE_SIZE + TILE_SIZE / 2
          ch.x = cx
          ch.y = cy
          ch.dir = seat.facingDir
          continue
        }
      }
      ch.seatId = null // will be reassigned below
    }

    // Second pass: assign remaining characters to free seats
    for (const ch of this.characters.values()) {
      if (ch.isMascot) continue // mascots have fixed positions, not seats
      if (ch.seatId) continue
      const seatId = this.findFreeSeat()
      if (seatId) {
        this.seats.get(seatId)!.assigned = true
        ch.seatId = seatId
        const seat = this.seats.get(seatId)!
        ch.tileCol = seat.seatCol
        ch.tileRow = seat.seatRow
        ch.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2
        ch.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2
        ch.dir = seat.facingDir
      }
    }

    // Relocate any characters that ended up outside bounds or on non-walkable tiles
    for (const ch of this.characters.values()) {
      if (ch.seatId) continue // seated characters are fine
      if (ch.tileCol < 0 || ch.tileCol >= layout.cols || ch.tileRow < 0 || ch.tileRow >= layout.rows) {
        this.relocateCharacterToWalkable(ch)
      }
    }
  }

  /** Move a character to a random walkable tile */
  private relocateCharacterToWalkable(ch: Character): void {
    if (this.walkableTiles.length === 0) return
    const spawn = this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)]
    ch.tileCol = spawn.col
    ch.tileRow = spawn.row
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2
    ch.path = []
    ch.moveProgress = 0
  }

  /** Build walkable tiles filtered to the café zone (if defined in layout) */
  private buildCafeWalkableTiles(): Array<{ col: number; row: number }> {
    const zone = this.layout.cafeZone
    if (!zone) return []
    return this.walkableTiles.filter(t =>
      t.col >= zone.colMin && t.col <= zone.colMax &&
      t.row >= zone.rowMin && t.row <= zone.rowMax
    )
  }

  /** Build walkable tiles for the Chefzimmer (mascot wander zone) */
  private buildMascotWalkableTiles(): Array<{ col: number; row: number }> {
    // Zone anchored to Chefzimmer button position (col 16, row 17)
    const minCol = CHEFZIMMER_BUTTON_COL - 4
    const minRow = CHEFZIMMER_BUTTON_ROW - 1
    const zone = this.walkableTiles.filter(t => t.col >= minCol && t.row >= minRow)
    return zone.length >= 4 ? zone : this.walkableTiles
  }

  /** Blocked tiles for mascot pathfinding: everything outside the Chefzimmer zone is blocked */
  private buildMascotBlockedTiles(): Set<string> {
    const minCol = CHEFZIMMER_BUTTON_COL - 4
    const minRow = CHEFZIMMER_BUTTON_ROW - 1
    const blocked = new Set(this.blockedTiles)
    for (const t of this.walkableTiles) {
      if (t.col < minCol || t.row < minRow) {
        blocked.add(`${t.col},${t.row}`)
      }
    }
    return blocked
  }

  /** Build list of seat UIDs that are within the café zone */
  private buildCafeSeatIds(): string[] {
    const zone = this.layout.cafeZone
    if (!zone) return []
    const ids: string[] = []
    for (const [uid, seat] of this.seats) {
      if (seat.seatCol >= zone.colMin && seat.seatCol <= zone.colMax &&
          seat.seatRow >= zone.rowMin && seat.seatRow <= zone.rowMax) {
        ids.push(uid)
      }
    }
    return ids
  }

  getLayout(): OfficeLayout {
    return this.layout
  }

  /** Get the blocked-tile key for a character's own seat, or null */
  private ownSeatKey(ch: Character): string | null {
    if (!ch.seatId) return null
    const seat = this.seats.get(ch.seatId)
    if (!seat) return null
    return `${seat.seatCol},${seat.seatRow}`
  }

  /** Temporarily unblock a character's own seat, run fn, then re-block */
  private withOwnSeatUnblocked<T>(ch: Character, fn: () => T): T {
    const key = this.ownSeatKey(ch)
    if (key) this.blockedTiles.delete(key)
    const result = fn()
    if (key) this.blockedTiles.add(key)
    return result
  }

  private findFreeSeat(): string | null {
    for (const [uid, seat] of this.seats) {
      if (!seat.assigned) return uid
    }
    return null
  }

  /**
   * Pick a diverse palette for a new agent based on currently active agents.
   * First 6 agents each get a unique skin (random order). Beyond 6, skins
   * repeat in balanced rounds with a random hue shift (≥45°).
   */
  private pickDiversePalette(): { palette: number; hueShift: number } {
    // Count how many non-sub-agents use each base palette (0-5)
    const counts = new Array(PALETTE_COUNT).fill(0) as number[]
    for (const ch of this.characters.values()) {
      if (ch.isSubagent || ch.isMascot) continue
      if (ch.palette >= 0 && ch.palette < PALETTE_COUNT) {
        counts[ch.palette]++
      }
    }
    const minCount = Math.min(...counts)
    // Available = palettes at the minimum count (least used)
    const available: number[] = []
    for (let i = 0; i < PALETTE_COUNT; i++) {
      if (counts[i] === minCount) available.push(i)
    }
    const palette = available[Math.floor(Math.random() * available.length)]
    // First round (minCount === 0): no hue shift. Subsequent rounds: random ≥45°.
    let hueShift = 0
    if (minCount > 0) {
      hueShift = HUE_SHIFT_MIN_DEG + Math.floor(Math.random() * HUE_SHIFT_RANGE_DEG)
    }
    return { palette, hueShift }
  }

  addAgent(id: number, preferredPalette?: number, preferredHueShift?: number, preferredSeatId?: string, skipSpawnEffect?: boolean, folderName?: string, projectPath?: string): void {
    if (this.characters.has(id)) return

    let palette: number
    let hueShift: number
    if (preferredPalette !== undefined) {
      palette = preferredPalette
      hueShift = preferredHueShift ?? 0
    } else if (
      (folderName && folderName.toLowerCase().includes('actimento')) ||
      (projectPath && projectPath.toLowerCase().includes('actimento'))
    ) {
      // Actimento Hub gets its own CI character (char_6)
      palette = 6
      hueShift = 0
    } else if (
      (folderName && folderName.toLowerCase().includes('mahnwesen')) ||
      (projectPath && projectPath.toLowerCase().includes('mahnwesen'))
    ) {
      // Mahnwesen: fixed blue-violet identity
      palette = 2
      hueShift = 210
    } else if (
      (folderName && (folderName.toLowerCase().includes('roehll') || folderName.toLowerCase().includes('röhl'))) ||
      (projectPath && (projectPath.toLowerCase().includes('roehll') || projectPath.toLowerCase().includes('röhl')))
    ) {
      // Röhl / KI-Assistent: fixed warm amber identity
      palette = 4
      hueShift = 90
    } else {
      const pick = this.pickDiversePalette()
      palette = pick.palette
      hueShift = pick.hueShift
    }

    // Try preferred seat first, then any free seat
    let seatId: string | null = null
    if (preferredSeatId && this.seats.has(preferredSeatId)) {
      const seat = this.seats.get(preferredSeatId)!
      if (!seat.assigned) {
        seatId = preferredSeatId
      }
    }
    if (!seatId) {
      seatId = this.findFreeSeat()
    }

    let ch: Character
    if (seatId) {
      const seat = this.seats.get(seatId)!
      seat.assigned = true
      ch = createCharacter(id, palette, seatId, seat, hueShift)
    } else {
      // No seats — spawn at random walkable tile
      const spawn = this.walkableTiles.length > 0
        ? this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)]
        : { col: 1, row: 1 }
      ch = createCharacter(id, palette, null, null, hueShift)
      ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2
      ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2
      ch.tileCol = spawn.col
      ch.tileRow = spawn.row
    }

    if (folderName) {
      ch.folderName = folderName
    }
    if (!skipSpawnEffect) {
      ch.matrixEffect = 'spawn'
      ch.matrixEffectTimer = 0
      ch.matrixEffectSeeds = matrixEffectSeeds()
    } else {
      // Restored agent: default to inactive until new JSONL events prove otherwise
      ch.isActive = false
    }
    this.characters.set(id, ch)
  }

  removeAgent(id: number): void {
    const ch = this.characters.get(id)
    if (!ch) return
    if (ch.matrixEffect === 'despawn') return // already despawning
    // Free seat and clear selection immediately
    if (ch.seatId) {
      const seat = this.seats.get(ch.seatId)
      if (seat) seat.assigned = false
    }
    if (this.selectedAgentId === id) this.selectedAgentId = null
    if (this.cameraFollowId === id) this.cameraFollowId = null
    // Start despawn animation instead of immediate delete
    ch.matrixEffect = 'despawn'
    ch.matrixEffectTimer = 0
    ch.matrixEffectSeeds = matrixEffectSeeds()
    ch.bubbleType = null
  }

  /** Find seat uid at a given tile position, or null */
  getSeatAtTile(col: number, row: number): string | null {
    for (const [uid, seat] of this.seats) {
      if (seat.seatCol === col && seat.seatRow === row) return uid
    }
    return null
  }

  /** Reassign an agent from their current seat to a new seat */
  reassignSeat(agentId: number, seatId: string): void {
    const ch = this.characters.get(agentId)
    if (!ch) return
    // Unassign old seat
    if (ch.seatId) {
      const old = this.seats.get(ch.seatId)
      if (old) old.assigned = false
    }
    // Assign new seat
    const seat = this.seats.get(seatId)
    if (!seat || seat.assigned) return
    seat.assigned = true
    ch.seatId = seatId
    // Pathfind to new seat (unblock own seat tile for this query)
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles)
    )
    if (path.length > 0) {
      ch.path = path
      ch.moveProgress = 0
      ch.state = CharacterState.WALK
      ch.frame = 0
      ch.frameTimer = 0
    } else {
      // Already at seat or no path — sit down
      ch.state = CharacterState.TYPE
      ch.dir = seat.facingDir
      ch.frame = 0
      ch.frameTimer = 0
      if (!ch.isActive) {
        ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC
      }
    }
  }

  /** Send an agent back to their currently assigned seat */
  sendToSeat(agentId: number): void {
    const ch = this.characters.get(agentId)
    if (!ch || !ch.seatId) return
    const seat = this.seats.get(ch.seatId)
    if (!seat) return
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles)
    )
    if (path.length > 0) {
      ch.path = path
      ch.moveProgress = 0
      ch.state = CharacterState.WALK
      ch.frame = 0
      ch.frameTimer = 0
    } else {
      // Already at seat — sit down
      ch.state = CharacterState.TYPE
      ch.dir = seat.facingDir
      ch.frame = 0
      ch.frameTimer = 0
      if (!ch.isActive) {
        ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC
      }
    }
  }

  /** Walk an agent to an arbitrary walkable tile (right-click command) */
  walkToTile(agentId: number, col: number, row: number): boolean {
    const ch = this.characters.get(agentId)
    if (!ch || ch.isSubagent) return false
    if (!isWalkable(col, row, this.tileMap, this.blockedTiles)) {
      // Also allow walking to own seat tile (blocked for others but not self)
      const key = this.ownSeatKey(ch)
      if (!key || key !== `${col},${row}`) return false
    }
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, col, row, this.tileMap, this.blockedTiles)
    )
    if (path.length === 0) return false
    ch.path = path
    ch.moveProgress = 0
    ch.state = CharacterState.WALK
    ch.frame = 0
    ch.frameTimer = 0
    return true
  }

  /** Create a sub-agent character with the parent's palette. Returns the sub-agent ID. */
  addSubagent(parentAgentId: number, parentToolId: string): number {
    const key = `${parentAgentId}:${parentToolId}`
    if (this.subagentIdMap.has(key)) return this.subagentIdMap.get(key)!

    const id = this.nextSubagentId--
    const parentCh = this.characters.get(parentAgentId)
    const palette = parentCh ? parentCh.palette : 0
    const hueShift = parentCh ? parentCh.hueShift : 0

    const parentCol = parentCh ? parentCh.tileCol : 0
    const parentRow = parentCh ? parentCh.tileRow : 0
    const dist = (c: number, r: number) =>
      Math.abs(c - parentCol) + Math.abs(r - parentRow)

    // Find closest free seat to parent
    let bestSeatId: string | null = null
    let bestDist = Infinity
    for (const [uid, seat] of this.seats) {
      if (!seat.assigned) {
        const d = dist(seat.seatCol, seat.seatRow)
        if (d < bestDist) {
          bestDist = d
          bestSeatId = uid
        }
      }
    }

    // Collect spawn tiles already used by sibling subagents of the same parent
    const siblingSpawnTiles = new Set<string>()
    for (const [sid, meta] of this.subagentMeta) {
      if (meta.parentAgentId === parentAgentId) {
        const sibCh = this.characters.get(sid)
        if (sibCh) siblingSpawnTiles.add(`${sibCh.tileCol},${sibCh.tileRow}`)
      }
    }

    // Find closest walkable tile not already used by a sibling subagent
    let spawnTile = { col: parentCol, row: parentRow }
    if (this.walkableTiles.length > 0) {
      const sorted = [...this.walkableTiles].sort((a, b) => dist(a.col, a.row) - dist(b.col, b.row))
      const tile = sorted.find(t => !siblingSpawnTiles.has(`${t.col},${t.row}`)) ?? sorted[0]
      spawnTile = tile
    }

    // Spawn at walkable tile near parent, then walk to seat after spawn effect
    const ch = createCharacter(id, palette, null, null, hueShift)
    ch.x = spawnTile.col * TILE_SIZE + TILE_SIZE / 2
    ch.y = spawnTile.row * TILE_SIZE + TILE_SIZE / 2
    ch.tileCol = spawnTile.col
    ch.tileRow = spawnTile.row

    if (bestSeatId) {
      const seat = this.seats.get(bestSeatId)!
      seat.assigned = true
      ch.seatId = bestSeatId
      // IDLE + isActive=true → after spawn effect, FSM pathfinds to seat and walks there
      ch.state = CharacterState.IDLE
    }

    ch.isSubagent = true
    ch.parentAgentId = parentAgentId
    ch.matrixEffect = 'spawn'
    ch.matrixEffectTimer = 0
    ch.matrixEffectSeeds = matrixEffectSeeds()
    this.characters.set(id, ch)

    this.subagentIdMap.set(key, id)
    this.subagentMeta.set(id, { parentAgentId, parentToolId })
    return id
  }

  /** Remove a specific sub-agent character and free its seat */
  removeSubagent(parentAgentId: number, parentToolId: string): void {
    const key = `${parentAgentId}:${parentToolId}`
    const id = this.subagentIdMap.get(key)
    if (id === undefined) return

    const ch = this.characters.get(id)
    if (ch) {
      if (ch.matrixEffect === 'despawn') {
        // Already despawning — just clean up maps
        this.subagentIdMap.delete(key)
        this.subagentMeta.delete(id)
        return
      }
      if (ch.seatId) {
        const seat = this.seats.get(ch.seatId)
        if (seat) seat.assigned = false
      }
      // Start despawn animation — keep character in map for rendering
      ch.matrixEffect = 'despawn'
      ch.matrixEffectTimer = 0
      ch.matrixEffectSeeds = matrixEffectSeeds()
      ch.bubbleType = null
    }
    // Clean up tracking maps immediately so keys don't collide
    this.subagentIdMap.delete(key)
    this.subagentMeta.delete(id)
    if (this.selectedAgentId === id) this.selectedAgentId = null
    if (this.cameraFollowId === id) this.cameraFollowId = null
  }

  /** Remove all sub-agents belonging to a parent agent */
  removeAllSubagents(parentAgentId: number): void {
    const toRemove: string[] = []
    for (const [key, id] of this.subagentIdMap) {
      const meta = this.subagentMeta.get(id)
      if (meta && meta.parentAgentId === parentAgentId) {
        const ch = this.characters.get(id)
        if (ch) {
          if (ch.matrixEffect === 'despawn') {
            // Already despawning — just clean up maps
            this.subagentMeta.delete(id)
            toRemove.push(key)
            continue
          }
          if (ch.seatId) {
            const seat = this.seats.get(ch.seatId)
            if (seat) seat.assigned = false
          }
          // Start despawn animation
          ch.matrixEffect = 'despawn'
          ch.matrixEffectTimer = 0
          ch.matrixEffectSeeds = matrixEffectSeeds()
          ch.bubbleType = null
        }
        this.subagentMeta.delete(id)
        if (this.selectedAgentId === id) this.selectedAgentId = null
        if (this.cameraFollowId === id) this.cameraFollowId = null
        toRemove.push(key)
      }
    }
    for (const key of toRemove) {
      this.subagentIdMap.delete(key)
    }
  }

  /** Look up the sub-agent character ID for a given parent+toolId, or null */
  getSubagentId(parentAgentId: number, parentToolId: string): number | null {
    return this.subagentIdMap.get(`${parentAgentId}:${parentToolId}`) ?? null
  }

  setAgentActive(id: number, active: boolean): void {
    const ch = this.characters.get(id)
    if (ch) {
      ch.isActive = active
      if (active && ch.cafePhase) {
        // Clear café state — agent is returning to work
        const wasWalking = ch.state === CharacterState.WALK
        ch.cafePhase = null
        ch.cafeBrewTimer = 0
        ch.cafeSeatId = null
        if (!wasWalking) {
          // Was sitting/brewing in TYPE — force to IDLE so handler routes to work seat
          ch.state = CharacterState.IDLE
          ch.frame = 0
          ch.frameTimer = 0
        }
        // If was WALK, the walk handler's repath logic will redirect to work seat
      }
      if (!active) {
        // Grace period: keep character seated for TURN_END_GRACE_SEC before going idle.
        // Prevents walking-while-working when a new turn starts quickly after a turn ends.
        ch.seatTimer = TURN_END_GRACE_SEC
        ch.skipNextSeatRest = true
        ch.path = []
        ch.moveProgress = 0
      }
      this.rebuildFurnitureInstances()
    }
  }

  /** Tracks visual door state overrides (uid → open/closed type) without modifying saved layout */
  private doorVisualStates = new Map<string, string>()

  /** Rebuild furniture instances with auto-state applied (active agents turn electronics ON, doors open/close) */
  private rebuildFurnitureInstances(): void {
    // Collect tiles where active agents face desks
    const autoOnTiles = new Set<string>()
    for (const ch of this.characters.values()) {
      if (!ch.isActive || !ch.seatId) continue
      const seat = this.seats.get(ch.seatId)
      if (!seat) continue
      const dCol = seat.facingDir === Direction.RIGHT ? 1 : seat.facingDir === Direction.LEFT ? -1 : 0
      const dRow = seat.facingDir === Direction.DOWN ? 1 : seat.facingDir === Direction.UP ? -1 : 0
      for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
        const tileCol = seat.seatCol + dCol * d
        const tileRow = seat.seatRow + dRow * d
        autoOnTiles.add(`${tileCol},${tileRow}`)
      }
      for (let d = 1; d <= AUTO_ON_SIDE_DEPTH; d++) {
        const baseCol = seat.seatCol + dCol * d
        const baseRow = seat.seatRow + dRow * d
        if (dCol !== 0) {
          autoOnTiles.add(`${baseCol},${baseRow - 1}`)
          autoOnTiles.add(`${baseCol},${baseRow + 1}`)
        } else {
          autoOnTiles.add(`${baseCol - 1},${baseRow}`)
          autoOnTiles.add(`${baseCol + 1},${baseRow}`)
        }
      }
    }

    // Build modified furniture list with auto-state and door visual states applied
    const modifiedFurniture: PlacedFurniture[] = this.layout.furniture.map((item) => {
      // Apply door visual state override
      if (isDoor(item.type) && this.doorVisualStates.has(item.uid)) {
        return { ...item, type: this.doorVisualStates.get(item.uid)! }
      }
      // Apply auto-on state for electronics
      if (autoOnTiles.size === 0) return item
      const entry = getCatalogEntry(item.type)
      if (!entry) return item
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          if (autoOnTiles.has(`${item.col + dc},${item.row + dr}`)) {
            const onType = getOnStateType(item.type)
            if (onType !== item.type) {
              return { ...item, type: onType }
            }
            return item
          }
        }
      }
      return item
    })

    const rebuilt = layoutToFurnitureInstances(modifiedFurniture)
    // Guard: if layout has furniture but rebuild returns empty, the dynamic
    // catalog isn't loaded yet — keep existing instances to avoid blank office
    if (rebuilt.length === 0 && modifiedFurniture.length > 0) return
    this.furniture = rebuilt
  }

  /** Auto-open/close doors based on agent proximity */
  private updateDoors(): void {
    // Collect agent tile positions and their next step
    const agentTiles = new Set<string>()
    for (const ch of this.characters.values()) {
      if (ch.matrixEffect) continue
      agentTiles.add(`${ch.tileCol},${ch.tileRow}`)
      if (ch.state === CharacterState.WALK && ch.path.length > 0) {
        agentTiles.add(`${ch.path[0].col},${ch.path[0].row}`)
      }
    }

    let changed = false
    for (const item of this.layout.furniture) {
      if (!isDoor(item.type)) continue
      const entry = getCatalogEntry(item.type)
      if (!entry) continue

      // Check all tiles of this door's footprint
      let agentNear = false
      for (let dr = 0; dr < entry.footprintH && !agentNear; dr++) {
        for (let dc = 0; dc < entry.footprintW && !agentNear; dc++) {
          if (agentTiles.has(`${item.col + dc},${item.row + dr}`)) {
            agentNear = true
          }
        }
      }

      // Determine current visual state
      const visualType = this.doorVisualStates.get(item.uid) ?? item.type
      const currentlyOpen = isOpenDoor(visualType)

      if (agentNear && !currentlyOpen) {
        // Open the door (visually)
        const openType = getToggledType(item.type)
        if (openType) {
          this.doorVisualStates.set(item.uid, openType)
          changed = true
          playDoorSound()
        }
      } else if (!agentNear && currentlyOpen && this.doorVisualStates.has(item.uid)) {
        // Close the door (visually) — only if we opened it (has override)
        this.doorVisualStates.delete(item.uid)
        changed = true
        playDoorSound()
      }
    }

    if (changed) {
      this.rebuildFurnitureInstances()
    }
  }

  setAgentTool(id: number, tool: string | null): void {
    const ch = this.characters.get(id)
    if (ch) {
      ch.currentTool = tool
    }
  }

  showPermissionBubble(id: number): void {
    const ch = this.characters.get(id)
    if (ch) {
      ch.bubbleType = 'permission'
      ch.bubbleTimer = 0
    }
  }

  clearPermissionBubble(id: number): void {
    const ch = this.characters.get(id)
    if (ch && ch.bubbleType === 'permission') {
      ch.bubbleType = null
      ch.bubbleTimer = 0
    }
  }

  showWaitingBubble(id: number): void {
    const ch = this.characters.get(id)
    if (ch) {
      ch.bubbleType = 'waiting'
      ch.bubbleTimer = WAITING_BUBBLE_DURATION_SEC
    }
  }

  /** Dismiss bubble on click — permission: instant, waiting: quick fade */
  dismissBubble(id: number): void {
    const ch = this.characters.get(id)
    if (!ch || !ch.bubbleType) return
    if (ch.bubbleType === 'permission') {
      ch.bubbleType = null
      ch.bubbleTimer = 0
    } else if (ch.bubbleType === 'waiting') {
      // Trigger immediate fade (0.3s remaining)
      ch.bubbleTimer = Math.min(ch.bubbleTimer, DISMISS_BUBBLE_FAST_FADE_SEC)
    }
  }

  update(dt: number): void {
    const toDelete: number[] = []
    for (const ch of this.characters.values()) {
      // Handle matrix effect animation
      if (ch.matrixEffect) {
        ch.matrixEffectTimer += dt
        if (ch.matrixEffectTimer >= MATRIX_EFFECT_DURATION) {
          if (ch.matrixEffect === 'spawn') {
            // Spawn complete — clear effect, resume normal FSM
            ch.matrixEffect = null
            ch.matrixEffectTimer = 0
            ch.matrixEffectSeeds = []
          } else {
            // Despawn complete — mark for deletion
            toDelete.push(ch.id)
          }
        }
        continue // skip normal FSM while effect is active
      }

      // Temporarily unblock own seat so character can pathfind to it
      if (ch.isMascot) {
        // Mascot wanders freely in the Chefzimmer — zone-restricted blocked tiles prevent it from leaving
        updateCharacter(ch, dt, this.mascotWalkableTiles, this.seats, this.tileMap, this.mascotBlockedTiles, this.mascotWalkableTiles)
      } else {
        this.withOwnSeatUnblocked(ch, () =>
          updateCharacter(ch, dt, this.walkableTiles, this.seats, this.tileMap, this.blockedTiles, this.cafeWalkableTiles)
        )
      }

      // Handle café phase transitions (after the basic FSM runs) — mascots don't do café
      if (!ch.isMascot) this.updateCafePhase(ch, dt)

      // Tick bubble timer for waiting bubbles
      if (ch.bubbleType === 'waiting') {
        ch.bubbleTimer -= dt
        if (ch.bubbleTimer <= 0) {
          ch.bubbleType = null
          ch.bubbleTimer = 0
          ch.bubbleText = undefined
        }
      }

      // Mascot random idle bubbles (cafeBrewTimer repurposed as bubble cooldown)
      if (ch.isMascot && ch.bubbleType === null) {
        ch.cafeBrewTimer -= dt
        if (ch.cafeBrewTimer <= 0) {
          ch.bubbleType = 'waiting'
          ch.bubbleText = MASCOT_MESSAGES[Math.floor(Math.random() * MASCOT_MESSAGES.length)]
          ch.bubbleTimer = MASCOT_BUBBLE_DURATION_SEC
          ch.cafeBrewTimer = 10 + Math.random() * 15
        }
      }
    }
    // Remove characters that finished despawn
    for (const id of toDelete) {
      this.characters.delete(id)
    }

    // Auto-open/close doors based on agent proximity
    this.updateDoors()
  }

  /** Manage café routine phase transitions for a character */
  private updateCafePhase(ch: Character, dt: number): void {
    // Start café routine when agent just became idle (no café phase yet)
    if (!ch.isActive && ch.state === CharacterState.IDLE && !ch.cafePhase) {
      this.startCafeRoutine(ch)
      return
    }

    // Handle phase-specific transitions
    if (ch.cafePhase === 'going_to_counter' && ch.state === CharacterState.TYPE) {
      // Walk to counter completed → start brewing
      const zone = this.layout.cafeZone
      const faceDir = zone?.counterFaceDir
      if (faceDir !== undefined) ch.dir = faceDir as 0 | 1 | 2 | 3
      ch.cafePhase = 'brewing'
      ch.cafeBrewTimer = CAFE_BREW_DURATION_SEC
      return
    }

    if (ch.cafePhase === 'brewing') {
      // Count down brew timer
      ch.cafeBrewTimer -= dt
      if (ch.cafeBrewTimer <= 0) {
        // Brewing done — find a café seat
        if (!this.assignCafeSeatAndGo(ch)) {
          // No café seat available — fall back to wandering in café zone
          ch.cafePhase = null
          ch.state = CharacterState.IDLE
          ch.frame = 0
          ch.frameTimer = 0
        }
      }
      return
    }

    if (ch.cafePhase === 'going_to_seat' && ch.state === CharacterState.TYPE) {
      // Walk to café seat completed → sit down
      if (ch.cafeSeatId) {
        const cafeSeat = this.seats.get(ch.cafeSeatId)
        if (cafeSeat) ch.dir = cafeSeat.facingDir
      }
      ch.cafePhase = 'sitting'
      return
    }

    // 'sitting' phase: just stay put, nothing to do until setAgentActive(true) clears it
  }

  /** Start the café routine: pathfind to counter tile */
  private startCafeRoutine(ch: Character): boolean {
    const counterTile = this.layout.cafeZone?.counterTile
    if (!counterTile) return false

    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, counterTile.col, counterTile.row, this.tileMap, this.blockedTiles)
    )
    if (path.length === 0) return false

    ch.cafePhase = 'going_to_counter'
    ch.path = path
    ch.moveProgress = 0
    ch.state = CharacterState.WALK
    ch.frame = 0
    ch.frameTimer = 0
    return true
  }

  /** After brewing, find a free café seat and pathfind there */
  private assignCafeSeatAndGo(ch: Character): boolean {
    if (this.cafeSeatIds.length === 0) return false

    // Collect occupied café seats
    const occupied = new Set<string>()
    for (const other of this.characters.values()) {
      if (other.cafeSeatId) occupied.add(other.cafeSeatId)
    }

    // Shuffle available seats
    const available = this.cafeSeatIds.filter(id => !occupied.has(id))
    if (available.length === 0) return false

    for (let i = available.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [available[i], available[j]] = [available[j], available[i]]
    }

    // Try each seat until we find one with a valid path
    for (const seatId of available) {
      const seat = this.seats.get(seatId)
      if (!seat) continue

      // Temporarily unblock the café seat tile for pathfinding
      const key = `${seat.seatCol},${seat.seatRow}`
      const wasBlocked = this.blockedTiles.has(key)
      this.blockedTiles.delete(key)
      const path = findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles)
      if (wasBlocked) this.blockedTiles.add(key)

      if (path.length > 0) {
        ch.cafeSeatId = seatId
        ch.cafePhase = 'going_to_seat'
        ch.path = path
        ch.moveProgress = 0
        ch.state = CharacterState.WALK
        ch.frame = 0
        ch.frameTimer = 0
        return true
      }
    }
    return false
  }

  getCharacters(): Character[] {
    return Array.from(this.characters.values())
  }

  /** Get character at pixel position (for hit testing). Returns id or null. */
  getCharacterAt(worldX: number, worldY: number): number | null {
    const chars = this.getCharacters().sort((a, b) => b.y - a.y)
    for (const ch of chars) {
      // Skip characters that are despawning
      if (ch.matrixEffect === 'despawn') continue
      // Character sprite is 16x24, anchored bottom-center
      // Apply sitting offset to match visual position
      const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0
      const anchorY = ch.y + sittingOffset
      const left = ch.x - CHARACTER_HIT_HALF_WIDTH
      const right = ch.x + CHARACTER_HIT_HALF_WIDTH
      const top = anchorY - CHARACTER_HIT_HEIGHT
      const bottom = anchorY
      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        return ch.id
      }
    }
    return null
  }
}
