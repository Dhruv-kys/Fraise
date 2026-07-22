export interface VoiceOption {
  id: string;
  name: string;
  gender: "Feminine" | "Masculine";
  accent: string;
  traits: string[];
  hue: number;
}

export const DEFAULT_VOICE = "aura-2-thalia-en";
export const INDIA_VOICE = "aura-2-draco-en";

export const VOICES: VoiceOption[] = [
  { id: "aura-2-thalia-en", name: "Thalia", gender: "Feminine", accent: "American", traits: ["Clear", "Confident", "Energetic", "Enthusiastic"], hue: 340 },
  { id: "aura-2-apollo-en", name: "Apollo", gender: "Masculine", accent: "American", traits: ["Confident", "Comfortable", "Casual"], hue: 210 },
  { id: "aura-2-luna-en", name: "Luna", gender: "Feminine", accent: "American", traits: ["Friendly", "Natural", "Engaging"], hue: 280 },
  { id: "aura-2-orion-en", name: "Orion", gender: "Masculine", accent: "American", traits: ["Approachable", "Comfortable", "Calm", "Polite"], hue: 190 },
  { id: "aura-2-aurora-en", name: "Aurora", gender: "Feminine", accent: "American", traits: ["Cheerful", "Expressive", "Energetic"], hue: 20 },
  { id: "aura-2-zeus-en", name: "Zeus", gender: "Masculine", accent: "American", traits: ["Deep", "Trustworthy", "Smooth"], hue: 230 },
  { id: "aura-2-athena-en", name: "Athena", gender: "Feminine", accent: "American", traits: ["Calm", "Smooth", "Professional"], hue: 165 },
  { id: "aura-2-draco-en", name: "Draco", gender: "Masculine", accent: "British", traits: ["Warm", "Approachable", "Trustworthy", "Baritone"], hue: 15 },
  { id: "aura-2-hera-en", name: "Hera", gender: "Feminine", accent: "American", traits: ["Smooth", "Warm", "Professional"], hue: 300 },
  { id: "aura-2-atlas-en", name: "Atlas", gender: "Masculine", accent: "American", traits: ["Enthusiastic", "Confident", "Approachable", "Friendly"], hue: 45 },
];

export function sampleUrl(id: string): string {
  return `/voices/${id}.mp3`;
}
