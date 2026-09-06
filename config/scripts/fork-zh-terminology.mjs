#!/usr/bin/env node
/**
 * This fork's Chinese wording, reapplied after a sync.
 *
 * `.gitattributes` keeps the locale catalogs on the keepupstream driver, because
 * en.json is regenerated from source and taking upstream's is right for it. The
 * translated catalogs ride along, and every sync therefore reverts the fork's
 * terminology to upstream's — 477 entries on 2026-09-05, all of them one word.
 *
 * A term list rather than a diff of the whole file: upstream also improves these
 * translations, and their improvements should survive. Only the words this fork
 * has decided differently are forced back.
 *
 * Run by sync-finish.sh; `--check` is what CI asserts.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

/**
 * Upstream renders "agent" as 代理; this fork uses 智能体 throughout.
 *
 * Keyed off the English entry rather than the Chinese: 代理 is also "proxy",
 * which upstream uses it for correctly, and no amount of surrounding-character
 * guessing separates the two reliably. en.json says which word the string is
 * actually translating, so the rule reads that and rewrites only the agents —
 * 379 entries against 18 proxies on 2026-09-05.
 */
/**
 * Phrases upstream leaves in English that this fork translates.
 *
 * Plain substitutions: unlike 代理 these have no second meaning to protect.
 */
export const ZH_PHRASES = [['Manta Mobile', 'Manta 手机端']]

const UPSTREAM_WORD = '代理'
const FORK_WORD = '智能体'

/**
 * Single strings this fork words differently, where no term rule applies.
 *
 * Kept short on purpose: each entry is a decision a test pins, so it earns its
 * place by failing when upstream's wording comes back.
 */
export const ZH_KEY_OVERRIDES = new Map([
  ['auto.components.status.bar.CaffeinateStatusSegment.active', '生效中']
])

/** True when the English source calls this an agent rather than a proxy. */
export function isAgentString(english) {
  if (typeof english !== 'string') {
    return false
  }
  const lower = english.toLowerCase()
  return lower.includes('agent') && !lower.includes('proxy')
}

/**
 * Catalog values also live in override modules, which the repair policy treats
 * as canonical — so fixing zh.json alone loses the next time the repair runs,
 * and `macos-tcc-prompt-localization` fails asserting the catalog survives it.
 *
 * Rewritten as source text rather than parsed: these are upstream's modules and
 * a `zh: '…'` line is the whole shape that matters. Each candidate line is still
 * decided by the English for its key, same as the catalog.
 */
const OVERRIDE_MODULES = [
  'config/scripts/locale-macos-tcc-key-overrides.mjs',
  'config/scripts/locale-zh-value-overrides.mjs',
  'config/scripts/locale-key-overrides.mjs',
  'config/scripts/locale-value-overrides.mjs'
]

function fixOverrideModule(file, english) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return 0
  }
  const lines = text.split('\n')
  let key = null
  let changed = 0
  for (let i = 0; i < lines.length; i += 1) {
    const keyLine = /^\s*'([^']+)':\s*\{/.exec(lines[i])
    if (keyLine) {
      key = keyLine[1]
      continue
    }
    const zhLine = /^(\s*zh:\s*')(.*)('[,]?)$/.exec(lines[i])
    if (!zhLine || !key || !zhLine[2].includes(UPSTREAM_WORD)) {
      continue
    }
    const en = key.split('.').reduce((node, part) => (node == null ? node : node[part]), english)
    if (!isAgentString(en)) {
      continue
    }
    lines[i] = zhLine[1] + zhLine[2].split(UPSTREAM_WORD).join(FORK_WORD) + zhLine[3]
    changed += 1
  }
  if (changed > 0) {
    writeFileSync(file, lines.join('\n'))
  }
  return changed
}

function main() {
  const check = process.argv.includes('--check')
  const dir = path.join('src', 'renderer', 'src', 'i18n', 'locales')
  const zhPath = path.join(dir, 'zh.json')
  const catalog = JSON.parse(readFileSync(zhPath, 'utf8'))
  const english = JSON.parse(readFileSync(path.join(dir, 'en.json'), 'utf8'))

  const lookup = (parts) =>
    parts.reduce((node, part) => (node == null ? node : node[part]), english)
  let changed = 0
  const visit = (node, trail) => {
    for (const [key, value] of Object.entries(node)) {
      const here = [...trail, key]
      if (typeof value === 'string') {
        const override = ZH_KEY_OVERRIDES.get(here.join('.'))
        let next = override ?? value
        for (const [from, to] of ZH_PHRASES) {
          next = next.split(from).join(to)
        }
        if (next.includes(UPSTREAM_WORD) && isAgentString(lookup(here))) {
          next = next.split(UPSTREAM_WORD).join(FORK_WORD)
        }
        if (next !== value) {
          node[key] = next
          changed += 1
        }
      } else if (value && typeof value === 'object') {
        visit(value, here)
      }
    }
  }
  visit(catalog, [])
  for (const file of OVERRIDE_MODULES) {
    changed += fixOverrideModule(file, english)
  }

  if (changed === 0) {
    console.log('zh.json already uses this fork\u2019s terminology')
    return
  }
  if (check) {
    console.error(
      `zh.json has ${changed} agent strings using upstream's 代理. Run ` +
        '`node config/scripts/fork-zh-terminology.mjs` to reapply.'
    )
    process.exit(1)
  }
  writeFileSync(zhPath, `${JSON.stringify(catalog, null, 2)}\n`)
  console.log(`zh.json: ${changed} agent strings restored to \u667a\u80fd\u4f53`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
