import {
  NOTIFICATION_NOTE_1_HZ,
  NOTIFICATION_NOTE_2_HZ,
  NOTIFICATION_NOTE_1_START_SEC,
  NOTIFICATION_NOTE_2_START_SEC,
  NOTIFICATION_NOTE_DURATION_SEC,
  NOTIFICATION_VOLUME,
  APPROVAL_NOTE_1_HZ,
  APPROVAL_NOTE_2_HZ,
  APPROVAL_NOTE_3_HZ,
  APPROVAL_NOTE_DURATION_SEC,
  APPROVAL_NOTE_GAP_SEC,
  APPROVAL_VOLUME,
  DOOR_SOUND_FREQ_HZ,
  DOOR_SOUND_DURATION_SEC,
  DOOR_SOUND_VOLUME,
} from './constants.js'

let soundEnabled = true
let doorSoundEnabled = true
let agentSoundEnabled = true
let audioCtx: AudioContext | null = null

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled
}

export function isSoundEnabled(): boolean {
  return soundEnabled
}

export function setDoorSoundEnabled(enabled: boolean): void {
  doorSoundEnabled = enabled
}

export function isDoorSoundEnabled(): boolean {
  return doorSoundEnabled
}

export function setAgentSoundEnabled(enabled: boolean): void {
  agentSoundEnabled = enabled
}

export function isAgentSoundEnabled(): boolean {
  return agentSoundEnabled
}

function playNote(ctx: AudioContext, freq: number, startOffset: number): void {
  const t = ctx.currentTime + startOffset
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, t)

  gain.gain.setValueAtTime(NOTIFICATION_VOLUME, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + NOTIFICATION_NOTE_DURATION_SEC)

  osc.connect(gain)
  gain.connect(ctx.destination)

  osc.start(t)
  osc.stop(t + NOTIFICATION_NOTE_DURATION_SEC)
}

export async function playDoneSound(): Promise<void> {
  if (!soundEnabled) return
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext()
    }
    // Resume suspended context (webviews suspend until user gesture)
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume()
    }
    // Ascending two-note chime: E5 → B5
    playNote(audioCtx, NOTIFICATION_NOTE_1_HZ, NOTIFICATION_NOTE_1_START_SEC)
    playNote(audioCtx, NOTIFICATION_NOTE_2_HZ, NOTIFICATION_NOTE_2_START_SEC)
  } catch {
    // Audio may not be available
  }
}

/** Play a descending 3-note chime when an agent needs approval */
export async function playApprovalSound(): Promise<void> {
  if (!soundEnabled) return
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext()
    }
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume()
    }
    // Descending: G5 → E5 → C5
    const freqs = [APPROVAL_NOTE_1_HZ, APPROVAL_NOTE_2_HZ, APPROVAL_NOTE_3_HZ]
    freqs.forEach((freq, i) => {
      const t = audioCtx!.currentTime + i * APPROVAL_NOTE_GAP_SEC
      const osc = audioCtx!.createOscillator()
      const gain = audioCtx!.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, t)
      gain.gain.setValueAtTime(APPROVAL_VOLUME, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + APPROVAL_NOTE_DURATION_SEC)
      osc.connect(gain)
      gain.connect(audioCtx!.destination)
      osc.start(t)
      osc.stop(t + APPROVAL_NOTE_DURATION_SEC)
    })
  } catch {
    // Audio may not be available
  }
}

/** Play a short click sound for door open/close */
export function playDoorSound(): void {
  if (!doorSoundEnabled) return
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext()
    }
    if (audioCtx.state === 'suspended') return // don't block on resume for game sounds
    const t = audioCtx.currentTime
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(DOOR_SOUND_FREQ_HZ, t)
    osc.frequency.exponentialRampToValueAtTime(DOOR_SOUND_FREQ_HZ * 0.5, t + DOOR_SOUND_DURATION_SEC)
    gain.gain.setValueAtTime(DOOR_SOUND_VOLUME, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + DOOR_SOUND_DURATION_SEC)
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.start(t)
    osc.stop(t + DOOR_SOUND_DURATION_SEC)
  } catch {
    // Audio may not be available
  }
}

/** Short "boop-beep" when an agent starts thinking (active turn begins) */
export function playThinkingSound(): void {
  if (!agentSoundEnabled) return
  try {
    if (!audioCtx) audioCtx = new AudioContext()
    if (audioCtx.state === 'suspended') return
    const t = audioCtx.currentTime
    for (const [offset, freq] of [[0, 523], [0.07, 659]] as [number, number][]) {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'square'
      osc.frequency.setValueAtTime(freq, t + offset)
      gain.gain.setValueAtTime(0.06, t + offset)
      gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.06)
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.start(t + offset)
      osc.stop(t + offset + 0.07)
    }
  } catch { /* ignore */ }
}

/** Rising chirp when a subagent is spawned */
export function playSubagentSpawnSound(): void {
  if (!agentSoundEnabled) return
  try {
    if (!audioCtx) audioCtx = new AudioContext()
    if (audioCtx.state === 'suspended') return
    const t = audioCtx.currentTime
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(300, t)
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.18)
    gain.gain.setValueAtTime(0.08, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2)
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.start(t)
    osc.stop(t + 0.2)
  } catch { /* ignore */ }
}

/** Falling plop when a subagent finishes */
export function playSubagentDoneSound(): void {
  if (!agentSoundEnabled) return
  try {
    if (!audioCtx) audioCtx = new AudioContext()
    if (audioCtx.state === 'suspended') return
    const t = audioCtx.currentTime
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, t)
    osc.frequency.exponentialRampToValueAtTime(330, t + 0.15)
    gain.gain.setValueAtTime(0.09, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.start(t)
    osc.stop(t + 0.18)
  } catch { /* ignore */ }
}

/** Call from any user-gesture handler to ensure AudioContext is unlocked */
export function unlockAudio(): void {
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext()
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume()
    }
  } catch {
    // ignore
  }
}
