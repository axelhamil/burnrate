import { describe, expect, test } from 'claude-code/testing'

import { HOUR_MS } from './pace'
import { weekSpend } from './sessions'

const SINCE_HOUR = 1_000
const SINCE = SINCE_HOUR * HOUR_MS

function session(id: string, label: string, hours: Record<string, number>) {
  return { id, label, hours }
}

describe('week spend', () => {
  test('given six projects, when ranking, then only the top 5 are listed', () => {
    const sessions = [1, 2, 3, 4, 5, 6].map(usd => session(`s${usd}`, `p${usd}`, { [SINCE_HOUR]: usd }))

    expect(weekSpend(sessions, SINCE, 's1').projects.map(project => project.label)).toEqual(['p6', 'p5', 'p4', 'p3', 'p2'])
  })

  test('given a project that spent nothing this week, when ranking, then it is left out', () => {
    const sessions = [session('a', 'idle', { [SINCE_HOUR - 1]: 4 }), session('b', 'busy', { [SINCE_HOUR]: 2 })]

    expect(weekSpend(sessions, SINCE, 'a').projects).toEqual([{ label: 'busy', usd: 2 }])
  })

  test('given two sessions of one project and a bucket in the first hour of the week, when ranking, then they add up', () => {
    const sessions = [session('a', 'api', { [SINCE_HOUR]: 2 }), session('b', 'api', { [SINCE_HOUR + 1]: 3 })]
    const spend = weekSpend(sessions, SINCE, 'a')

    expect(spend).toEqual({ sessionUsd: 2, projects: [{ label: 'api', usd: 5 }] })
  })
})
