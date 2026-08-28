// Voice channel system: every agent name hashes to one of eight fixed hues.
// The same hue colors the avatar chip, the message name plate, the voice rail
// on message cards, and A2A quote cards, so a speaker stays traceable across
// the whole interface.
const CHANNEL_COUNT = 8;

export function voiceChannel(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % CHANNEL_COUNT;
}

export function voiceColor(name: string): string {
  return `var(--voice-${voiceChannel(name)})`;
}

export function voiceChipColor(name: string): string {
  return `var(--voice-chip-${voiceChannel(name)})`;
}
