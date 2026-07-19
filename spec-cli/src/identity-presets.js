// One browser-safe identity registry shared by backend validation and every dashboard projection.
// Geometry is data so the React renderer and favicon serializer cannot drift into separate drawings.

export const DEFAULT_PROJECT_ICON = 'spexcode'
export const DEFAULT_GATEWAY_ICON = 'gateway'

export const IDENTITY_PRESETS = Object.freeze([
  {
    id: 'spexcode', label: 'SpexCode', bg: '#166534', fg: '#f0fdf4',
    shapes: [
      { tag: 'circle', cx: 12, cy: 6.2, r: 2.2 },
      { tag: 'circle', cx: 6.2, cy: 17.5, r: 2 },
      { tag: 'circle', cx: 17.8, cy: 17.5, r: 2 },
      { tag: 'path', d: 'M12 8.4v2.1c0 2.2-5.8 1.8-5.8 5' },
      { tag: 'path', d: 'M12 10.5c0 2.2 5.8 1.8 5.8 5' },
    ],
  },
  {
    id: 'gateway', label: 'Gateway', bg: '#155e75', fg: '#ecfeff',
    shapes: [
      { tag: 'path', d: 'm12 3 8 4.2-8 4.2-8-4.2Z' },
      { tag: 'path', d: 'm4 11.2 8 4.2 8-4.2' },
      { tag: 'path', d: 'm4 15.2 8 4.2 8-4.2' },
    ],
  },
  {
    id: 'mdi:rocket-launch', label: 'Rocket', bg: '#9f1239', fg: '#fff1f2',
    shapes: [
      { tag: 'path', d: 'M14.5 5.2c2.2-2.2 4.8-2 5.3-1.8.2.5.4 3.1-1.8 5.3l-5.5 5.5-4.2-4.2Z' },
      { tag: 'path', d: 'm11.2 6.8-4.1.6-2.5 2.5 4.1.7' },
      { tag: 'path', d: 'm16.4 12-1 4.7-2.5 2.5-.7-4.1' },
      { tag: 'circle', cx: 16.1, cy: 7.1, r: 1.2 },
      { tag: 'path', d: 'M7.6 14.6c-2.2.4-3.4 1.6-3.6 3.8 2.2-.2 3.4-1.4 3.8-3.6' },
    ],
  },
  {
    id: 'compass', label: 'Compass', bg: '#1d4ed8', fg: '#eff6ff',
    shapes: [
      { tag: 'circle', cx: 12, cy: 12, r: 8.5 },
      { tag: 'path', d: 'm15.2 8.8-1.8 4.6-4.6 1.8 1.8-4.6Z' },
    ],
  },
  {
    id: 'terminal', label: 'Terminal', bg: '#3f3f46', fg: '#fafafa',
    shapes: [
      { tag: 'rect', x: 3.5, y: 4.5, width: 17, height: 15, rx: 2 },
      { tag: 'path', d: 'm7 9 3 3-3 3' },
      { tag: 'path', d: 'M12.5 15H17' },
    ],
  },
  {
    id: 'package', label: 'Package', bg: '#6d28d9', fg: '#f5f3ff',
    shapes: [
      { tag: 'path', d: 'm12 3 8 4.5v9L12 21l-8-4.5v-9Z' },
      { tag: 'path', d: 'm4.3 7.7 7.7 4.4 7.7-4.4' },
      { tag: 'path', d: 'M12 12.1V21' },
    ],
  },
  {
    id: 'database', label: 'Database', bg: '#a16207', fg: '#fefce8',
    shapes: [
      { tag: 'ellipse', cx: 12, cy: 6, rx: 7.5, ry: 3 },
      { tag: 'path', d: 'M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6' },
      { tag: 'path', d: 'M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6' },
    ],
  },
  {
    id: 'spark', label: 'Spark', bg: '#c2410c', fg: '#fff7ed',
    shapes: [
      { tag: 'path', d: 'm12 3 1.5 5.2L19 10l-5.5 1.8L12 17l-1.5-5.2L5 10l5.5-1.8Z' },
      { tag: 'path', d: 'm18.5 15 .7 2.2 2.3.8-2.3.8-.7 2.2-.7-2.2-2.3-.8 2.3-.8Z' },
    ],
  },
])

const BY_ID = new Map(IDENTITY_PRESETS.map((preset) => [preset.id, preset]))
const ALIASES = new Map([
  ['rocket', 'mdi:rocket-launch'],
  ['mdi/rocket-launch', 'mdi:rocket-launch'],
  ['layers', 'gateway'],
  ['default', 'spexcode'],
])

export const IDENTITY_PRESET_IDS = Object.freeze(IDENTITY_PRESETS.map((preset) => preset.id))

export function resolvedIdentityIcon(value, fallback = DEFAULT_PROJECT_ICON) {
  const raw = typeof value === 'string' ? value.trim() : ''
  const id = ALIASES.get(raw) || raw
  return id || fallback
}

export function identityPreset(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  return BY_ID.get(ALIASES.get(raw) || raw) || null
}

export function requireIdentityPreset(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  const id = ALIASES.get(raw) || raw
  if (!BY_ID.has(id)) throw new Error(`unknown identity icon '${raw}' (choose: ${IDENTITY_PRESET_IDS.join(', ')})`)
  return id
}

function attrs(shape) {
  return Object.entries(shape).filter(([key]) => key !== 'tag')
    .map(([key, value]) => `${key === 'className' ? 'class' : key}="${String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`).join(' ')
}

export function identitySvg(value, fallback = DEFAULT_PROJECT_ICON) {
  const preset = identityPreset(value) || identityPreset(fallback)
  const geometry = preset.shapes.map((shape) => `<${shape.tag} ${attrs(shape)}/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22" rx="5" fill="${preset.bg}"/><g fill="none" stroke="${preset.fg}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${geometry}</g></svg>`
}

export function identityFaviconHref(value, fallback = DEFAULT_PROJECT_ICON) {
  const resolved = resolvedIdentityIcon(value, fallback)
  if (identityPreset(resolved)) return `data:image/svg+xml,${encodeURIComponent(identitySvg(resolved, fallback))}`
  if (/^https?:\/\//.test(resolved)) return resolved
  if (/^[a-z0-9-]+[:/][a-z0-9-]+$/i.test(resolved)) return `https://api.iconify.design/${resolved.replace(':', '/')}.svg`
  const glyph = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y=".86em" font-size="82" text-anchor="middle">${resolved.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(glyph)}`
}
