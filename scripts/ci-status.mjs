#!/usr/bin/env node

// Whether a commit passed GitHub Actions, as `gh run list` reports it.
// release.sh asks before a release (for HEAD) and before retry (for the
// tagged commit): its own checks don't build the create-byoky-app templates
// or run the e2e and emulator suites, and main has no required checks.
//
// Usage: node scripts/ci-status.mjs <commit>
//
// Exit 0 when CI and Security ran on the commit and the latest run of every
// workflow that ran on it (Android emulator runs only when the app changed)
// passed. Otherwise exit 1, with each problem on a line of its own.

import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const REQUIRED_WORKFLOWS = ['CI', 'Security']
const PASSED = ['success', 'skipped', 'neutral']

// runs: `gh run list --json workflowName,status,conclusion,createdAt,url,...`
// for the commit. failedJobs(run) lists a failed run's failed jobs.
export function ciProblems(runs, commit, failedJobs = () => []) {
  const short = commit.slice(0, 8)
  if (runs.length === 0) {
    return [`no GitHub Actions runs for ${short}: push it to main or a release/** branch and wait for CI`]
  }
  // A workflow can run more than once on a commit (a push to a release
  // branch, then to main); its latest run counts.
  const latest = new Map()
  for (const run of [...runs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))) {
    if (!latest.has(run.workflowName)) latest.set(run.workflowName, run)
  }
  const problems = REQUIRED_WORKFLOWS
    .filter((name) => !latest.has(name))
    .map((name) => `${name} didn't run on ${short}`)
  for (const run of latest.values()) {
    if (run.status !== 'completed') {
      problems.push(`${run.workflowName} is still ${String(run.status).replace(/_/g, ' ')} (${run.url})`)
    } else if (!PASSED.includes(run.conclusion)) {
      const jobs = failedJobs(run)
      problems.push(`${run.workflowName}: ${run.conclusion}${jobs.length ? ` in ${jobs.join(', ')}` : ''} (${run.url})`)
    }
  }
  return problems
}

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function failedJobs(run) {
  try {
    return (JSON.parse(gh('run', 'view', String(run.databaseId), '--json', 'jobs')).jobs ?? [])
      .filter((job) => job.status === 'completed' && !PASSED.includes(job.conclusion))
      .map((job) => job.name)
  } catch {
    return []
  }
}

function main() {
  const commit = process.argv[2]
  if (!commit) {
    console.error('Usage: ci-status.mjs <commit>')
    process.exit(1)
  }
  let runs
  try {
    runs = JSON.parse(gh('run', 'list', '--commit', commit, '--limit', '100',
      '--json', 'databaseId,workflowName,status,conclusion,createdAt,url'))
  } catch (e) {
    console.log(`couldn't list the GitHub Actions runs of ${commit.slice(0, 8)}: ${String(e.stderr || e.message).trim()}`)
    process.exit(1)
  }
  const problems = ciProblems(runs, commit, failedJobs)
  for (const p of problems) console.log(p)
  process.exitCode = problems.length ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main()
}
