import { expect, test } from 'claude-code/testing'

import { sparkGlyphs } from './band'

test('given days below, at and above the even pace, when drawn, then bars scale against the busiest day', () => {
  const days = [0, 7.15, 14.3, 30].map((used, index) => ({ date: `2026-10-1${index}`, used }))

  expect(sparkGlyphs(days).join('')).toBe('▁▂▄█')
})

test('given quiet days only, when drawn, then bars scale against the even pace instead of the busiest day', () => {
  const days = [1, 2].map((used, index) => ({ date: `2026-10-1${index}`, used }))

  expect(sparkGlyphs(days).join('')).toBe('▁▂')
})
