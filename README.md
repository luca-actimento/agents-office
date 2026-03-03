# Agents Office

> **Based on [Pixel Agents](https://github.com/pablodelucca/pixel-agents) by [Pablo De Lucca](https://github.com/pablodelucca)**
> Licensed under MIT. This project adds features like Café-Zone, Drag & Drop, Furniture Catalog, Door System and Auto-Updates.

### Your AI agents are alive. You're just watching them work.

Remember that Black Mirror episode with the Thronglets — tiny digital beings trapped in a screen, doing tasks while you watch? This is that, but real. Your AI coding agents become pixel-art characters in a virtual office. They walk to their desks, type when they write code, read when they search files, grab coffee when they're idle, and stare at you when they need permission. It's weirdly captivating. And slightly unsettling.

![Agents Office screenshot](webview-ui/public/Screenshot.jpg)

---

## Features

### Live Agent Characters
Every Claude Code terminal spawns an animated pixel-art character. The character reacts in real time to what the agent is doing — typing when it writes code, reading when it searches files, walking when it switches context.

### Activity Tracking
See at a glance what every agent is working on. Speech bubbles and status overlays show the current tool, and a red blink alerts you when permission is needed.

### Office Layout Editor
Design your own office with a built-in tilemap editor:
- **Floor** — 7 patterns with full HSB color control
- **Walls** — Auto-tiling walls with color customization
- **Tools** — Select, paint, erase, place, eyedropper, pick
- **Undo/Redo** — 50 levels (Ctrl+Z / Ctrl+Y)
- **Export/Import** — Share layouts as JSON

The grid is expandable up to 64x64 tiles.

### 100+ Furniture Items
Browse and place furniture from a built-in catalog panel. Desks, chairs, bookshelves, monitors, plants, lamps, wall art — organized by category with search.

### Drag & Drop
Rearrange your office without entering edit mode. Click and drag any piece of furniture to move it. A ghost preview shows valid (green) and invalid (red) placements.

### Cafe Zone
Idle agents don't just stand around — they visit the office cafe. An agent walks to the counter, brews a coffee (3s animation), then sits at a free cafe seat. When a new task arrives, they get up and walk back to their desk.

### Doors
Place doors between rooms. They auto-open when an agent walks through and close behind them, with sound effects.

### Permission Blink
When an agent needs your approval, its character overlay turns red and blinks. Hard to miss.

### Furniture Actions
Double-click any furniture to trigger custom actions — open files, run terminal commands, launch scripts. Configure via `~/.agents-office/furniture-actions.json`.

### Sub-Agent Visualization
When an agent spawns sub-agents (Task tool), each sub-agent gets its own character that inherits the parent's color palette.

### Sound Notifications
An ascending chime plays when an agent finishes work or needs attention. Toggle in settings.

### Seat Assignment
Click a character, then click a chair to reassign where they sit.

### Furniture Rotation
Right-click any rotatable furniture to cycle through orientations.

### Auto-Updates
The extension checks GitHub for new releases on every VS Code start and offers one-click updates.

<p align="center">
  <img src="webview-ui/public/characters.png" alt="Agent characters" width="320" height="72" style="image-rendering: pixelated;">
</p>

---

## Install

### One-liner (recommended)

```bash
bash <(curl -sSL https://raw.githubusercontent.com/luca-actimento/agents-office/main/install.sh)
```

### Manual (.vsix)

Download the latest `.vsix` from [Releases](https://github.com/luca-actimento/agents-office/releases) and run:

```bash
code --install-extension agents-office.vsix --force
```

Then reload VS Code (`Cmd+Shift+P` / `Ctrl+Shift+P` -> "Reload Window").

### From source

```bash
git clone https://github.com/luca-actimento/agents-office.git
cd agents-office
npm install
cd webview-ui && npm install && cd ..
npm run build
npx @vscode/vsce package --no-dependencies
code --install-extension agents-office-*.vsix --force
```

---

## Usage

1. Open the **Agents Office** panel (bottom panel area, next to Terminal)
2. Click **+ Agent** to spawn a new Claude Code terminal + character
3. Start coding with Claude — watch the character react in real time
4. Click a character to select it, then click a seat to reassign
5. Click **Layout** to open the editor and customize your office
6. Click **Furniture** to browse and place items from the catalog

---

## Office Assets

The tileset used for furniture and decorations is the [Office Interior Tileset (16x16)](https://donarg.itch.io/officetileset) by **Donarg** ($2 on itch.io). It's not included in the repo due to its license. To use the full furniture catalog:

```bash
npm run import-tileset
```

The extension works without the tileset — you get the default characters and basic layout, but the full 100+ item catalog requires the imported assets.

---

## How It Works

Agents Office watches Claude Code's JSONL transcript files to track what each agent is doing. When an agent uses a tool (writing a file, running a command, searching), the extension detects it and updates the character's animation. No modifications to Claude Code needed — purely observational.

The webview runs a lightweight game loop with canvas rendering, BFS pathfinding, and a character state machine (idle -> walk -> type/read). Everything is pixel-perfect at integer zoom levels.

---

## Tech Stack

- **Extension**: TypeScript, VS Code Webview API, esbuild
- **Webview**: React 19, TypeScript, Vite, Canvas 2D

---

## Roadmap

- **Project-specific agent designs** — Each project gets its own agent look/skin
- **Multi-IDE support** — JetBrains, Cursor, Windsurf (not just VS Code)
- **Emotes** — Agents show emotions (happy on test pass, frustrated on errors)
- **Agent end-of-day** — Click to send an agent home (walk to exit, despawn)
- **Pets** — Decorative pixel-art animals roaming the office
- **Weather effects** — Rain/snow visible through windows
- **Day/night cycle** — Lighting changes with time of day
- **Interactive furniture** — Whiteboard notes, printer animations, etc.
- **Agent teams** — Visualize multi-agent coordination
- **Git worktree support** — Agents in different worktrees

