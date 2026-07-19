import test from 'node:test'
import assert from 'node:assert/strict'
import {
  identityFaviconHref,
  identityPreset,
  isIconifyIcon,
  requireIdentityChoice,
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

test('structured choices accept presets and the established Iconify namespace', () => {
  assert.equal(identityPreset('mdi:rocket-launch').label, 'Rocket')
  assert.equal(requireIdentityChoice('rocket'), 'mdi:rocket-launch')
  assert.equal(requireIdentityChoice('lucide/radar'), 'lucide:radar')
  assert.equal(isIconifyIcon('simple-icons:github'), true)
  assert.throws(() => requireIdentityChoice('not a catalog choice'), /unknown identity icon/)
  assert.throws(() => requireIdentityChoice('https://example.test/new.svg'), /unknown identity icon/)
})
