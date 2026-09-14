import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { mergeLocaleCatalogs, retireAgainstEnglish } from './merge-locale-catalog.mjs'

const zh = (base, ours, theirs) => mergeLocaleCatalogs(base, ours, theirs, { isEnglish: false })
const en = (base, ours, theirs) => mergeLocaleCatalogs(base, ours, theirs, { isEnglish: true })

describe('merge-locale-catalog', () => {
  it('keeps a translation the fork added while upstream edited other keys', () => {
    // The failure it replaces: keepupstream took upstream's whole file and this
    // entry was gone.
    const base = { a: { one: '一' } }
    const ours = { a: { one: '一', two: '二' } }
    const theirs = { a: { one: '壹', three: '三' } }
    expect(zh(base, ours, theirs).catalog).toEqual({ a: { one: '壹', two: '二', three: '三' } })
  })

  it('follows the side that changed a key, deletions included', () => {
    const base = { gone: 'x', removedByFork: 'y', kept: 'z' }
    const ours = { gone: 'x', kept: 'z' }
    const theirs = { removedByFork: 'y', kept: 'z' }
    expect(zh(base, ours, theirs).catalog).toEqual({ kept: 'z' })
  })

  it('keeps the fork translation when both sides translated a key differently', () => {
    const { catalog, conflicts } = zh({ k: 'old' }, { k: '分享' }, { k: '共享' })
    expect(catalog).toEqual({ k: '分享' })
    expect(conflicts).toEqual([{ key: 'k', ours: '分享', theirs: '共享' }])
  })

  it('keeps upstream English, which is what upstream code declares', () => {
    expect(en({ k: 'Old' }, { k: 'Fork' }, { k: 'Upstream' }).catalog).toEqual({ k: 'Upstream' })
  })

  it('keeps upstream rewording a key the fork deleted', () => {
    // The merged code is upstream's there, so the key is still asked for.
    expect(zh({ k: 'a' }, {}, { k: 'b' }).catalog).toEqual({ k: 'b' })
  })

  it('retires a key upstream deleted even if the fork had translated it', () => {
    // The key was upstream's and its code stopped asking for it; keeping the
    // translation leaves an entry en.json no longer has, which the catalogue
    // gate rejects as extra.
    expect(zh({ k: 'Old', stay: 's' }, { k: '旧', stay: 's' }, { stay: 's' }).catalog).toEqual({
      stay: 's'
    })
  })

  it('writes an identical two-sided addition once', () => {
    expect(zh({}, { k: '同' }, { k: '同' }).catalog).toEqual({ k: '同' })
  })

  it('lets a new object replace the leaf it grew out of', () => {
    const base = { s: { x: 'Show more' } }
    const ours = { s: { x: '显示更多' } }
    const theirs = { s: { x: { variant: 'Show {{n}} more' } } }
    expect(zh(base, ours, theirs).catalog).toEqual({ s: { x: { variant: 'Show {{n}} more' } } })
  })

  it('never writes a leaf and an object at one path, whichever side added the leaf', () => {
    // Fork adds the leaf fresh while upstream grows the object: both survive
    // the per-key rule, so only the shadow check keeps the file writable.
    const { catalog, conflicts } = zh({}, { s: { x: '新' } }, { s: { x: { v: 'New' } } })
    expect(catalog).toEqual({ s: { x: { v: 'New' } } })
    expect(conflicts.some((conflict) => conflict.shadowed && conflict.key === 's.x')).toBe(true)
  })

  it('retires translations of keys English no longer has', () => {
    const catalog = { a: { keep: '留', gone: '去' }, empty: { only: '空' } }
    const retired = retireAgainstEnglish(catalog, { a: { keep: 'Keep' } })
    expect(catalog).toEqual({ a: { keep: '留' } })
    expect(retired.sort()).toEqual(['a.gone', 'empty.only'])
  })

  it("lays out upstream's order and slots fork-only keys after their fork neighbour", () => {
    const base = { a: '1', c: '3' }
    const ours = { a: '1', b: '2', c: '3' }
    const theirs = { c: '3', a: '1', d: '4' }
    expect(Object.keys(zh(base, ours, theirs).catalog)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('treats a catalogue missing on one side as empty', () => {
    expect(zh({}, { a: '一' }, { b: '二' }).catalog).toEqual({ b: '二', a: '一' })
  })
})

describe('merge-locale-catalog as a git merge driver', () => {
  const dirs = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes the merge into the ours path and exits 0', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'merge-locale-catalog-'))
    dirs.push(dir)
    const file = (name, value) => {
      const target = path.join(dir, name)
      writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`)
      return target
    }
    const base = file('base', { k: 'a' })
    const ours = file('ours', { k: 'a', fork: '译' })
    const theirs = file('theirs', { k: 'b' })
    execFileSync(
      process.execPath,
      [
        path.join(import.meta.dirname, 'merge-locale-catalog.mjs'),
        base,
        ours,
        theirs,
        'src/renderer/src/i18n/locales/zh.json'
      ],
      { stdio: 'pipe' }
    )
    expect(JSON.parse(readFileSync(ours, 'utf8'))).toEqual({ k: 'b', fork: '译' })
    expect(readFileSync(ours, 'utf8').endsWith('}\n')).toBe(true)
  })
})
