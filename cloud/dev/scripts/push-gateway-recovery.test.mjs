import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { readRelayWorkflow } from './relay-repository.mjs'

const workflow = readRelayWorkflow('push-deploy.yml')
function step(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`)
  assert.notEqual(start, -1)
  const end = workflow.indexOf('\n      - name:', start + 1)
  const block = workflow.slice(start, end === -1 ? undefined : end)
  return block.slice(block.indexOf('        run: |\n') + '        run: |\n'.length)
    .split('\n').filter((line) => line.startsWith('          ')).map((line) => line.slice(10)).join('\n')
}
const candidate = step('Deploy the candidate revision with no traffic')
const shift = step('Shift all traffic to the verified candidate')
const rollback = step('Roll traffic back to the previous revision')
const cleanup = step('Delete the rejected candidate revision')
const env = { SERVICE_NAME: 'push-test', GCP_PROJECT_ID: 'test', GCP_REGION: 'test',
  GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', IMAGE: 'synthetic-image',
  CANDIDATE_REVISION: 'push-test-c123-1', ROLLBACK_REVISION: 'push-test-old' }

function exercise(body) {
  const dir = mkdtempSync(join(tmpdir(), 'push-workflow-'))
  try {
    const run = spawnSync('bash', ['-c', body], { encoding: 'utf8', timeout: 10000,
      env: { ...process.env, ...env, GITHUB_ENV: join(dir, 'env'), GITHUB_STEP_SUMMARY: join(dir, 'summary'),
        TRACE: join(dir, 'trace'), STATE: join(dir, 'state') } })
    assert.equal(run.status, 0, run.stderr)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

// Workflow shell behavior is Linux-specific; these tests never call a real cloud CLI.
test('failed candidate discovery retains enough state to remove tag and revision', { skip: process.platform === 'win32' }, () => {
  exercise(`
    gcloud() {
      case "$*" in
        'run deploy '*) echo deployed > "$STATE" ;;
        'run services describe '*) return 1 ;;
        *) echo "$*" >> "$TRACE" ;;
      esac
    }
    jq() { return 1; }
    ( ${candidate} )
    test "$?" != 0 || exit 1
    source "$GITHUB_ENV"
    test "$CANDIDATE_TAG" = c123-1 || exit 1
    test "$CANDIDATE_REVISION" = push-test-c123-1 || exit 1
    ( ${cleanup} ) || exit 1
    grep -q -- '--remove-tags c123-1' "$TRACE" || exit 1
    grep -q 'run revisions delete push-test-c123-1' "$TRACE" || exit 1
  `)
})

test('failed post-promotion read retains intent and restores previous traffic', { skip: process.platform === 'win32' }, () => {
  exercise(`
    gcloud() {
      case "$*" in
        'run services update-traffic '*) echo "$*" >> "$TRACE" ;;
        'run services describe '*) return 1 ;;
      esac
    }
    jq() { return 1; }
    ( ${shift} )
    test "$?" != 0 || exit 1
    source "$GITHUB_ENV"
    test "$TRAFFIC_SHIFT_ATTEMPTED" = true || exit 1
    gcloud() {
      case "$*" in
        'run services update-traffic '*) echo "$*" >> "$TRACE" ;;
        'run services describe '*) echo '{}' ;;
      esac
    }
    jq() { echo "$ROLLBACK_REVISION"; }
    ( ${rollback} ) || exit 1
    source "$GITHUB_ENV"
    test "$TRAFFIC_ROLLED_BACK" = true || exit 1
    grep -q -- '--to-revisions push-test-old=100' "$TRACE" || exit 1
  `)
})

test('ambiguous promotion failure also leaves rollback intent', { skip: process.platform === 'win32' }, () => {
  exercise(`
    gcloud() { return 1; }
    ( ${shift} )
    test "$?" != 0 || exit 1
    source "$GITHUB_ENV"
    test "$TRAFFIC_SHIFT_ATTEMPTED" = true
  `)
})
