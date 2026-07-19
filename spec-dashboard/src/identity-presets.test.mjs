import test from 'node:test'
import assert from 'node:assert/strict'
import {
  identityFaviconHref,
  identityPreset,
  requireIdentityPreset,
  resolvedIdentityIcon,
} from '../../spec-cli/src/identity-presets.js'

test('preset favicons are local SVG data while legacy icon forms remain valid', () => {
  const preset = identityFaviconHref('compass')
  assert.match(preset, /^data:image\/svg\+xml,/)
  assert.match(decodeURIComponent(preset), /#1d4ed8/)
  assert.equal(identityFaviconHref('https://example.test/icon.svg'), 'https://example.test/icon.svg')
  assert.equal(identityFaviconHref('lucide:radar'), 'https://api.iconify.design/lucide/radar.svg')
  assert.match(decodeURIComponent(identityFaviconHref('🔭')), /🔭/)
  assert.equal(resolvedIdentityIcon('🛰️'), '🛰️')
  assert.equal(resolvedIdentityIcon('lucide:radar'), 'lucide:radar')
})

test('picker validation accepts only registry presets and keeps the existing rocket id canonical', () => {
  assert.equal(identityPreset('mdi:rocket-launch').label, 'Rocket')
  assert.equal(requireIdentityPreset('rocket'), 'mdi:rocket-launch')
  assert.throws(() => requireIdentityPreset('lucide:radar'), /unknown identity icon/)
})
