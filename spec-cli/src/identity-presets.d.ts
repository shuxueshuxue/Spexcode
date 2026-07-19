export type IdentityShape = { tag: string; [key: string]: string | number }
export type IdentityPreset = { id: string; label: string; bg: string; fg: string; shapes: IdentityShape[] }

export const DEFAULT_PROJECT_ICON: string
export const DEFAULT_GATEWAY_ICON: string
export const IDENTITY_PRESETS: readonly IdentityPreset[]
export const IDENTITY_PRESET_IDS: readonly string[]
export function resolvedIdentityIcon(value: unknown, fallback?: string): string
export function identityPreset(value: unknown): IdentityPreset | null
export function requireIdentityPreset(value: unknown): string
export function identitySvg(value: unknown, fallback?: string): string
export function identityFaviconHref(value: unknown, fallback?: string): string
