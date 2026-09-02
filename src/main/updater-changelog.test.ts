import { describe, expect, it } from 'vitest'
import { fetchChangelog } from './updater-changelog'

/**
 * The notes now arrive inside the update manifest rather than from a separate
 * host, so there is nothing to mock: these are pure transformations from what
 * electron-updater hands over into what the 360px card can hold.
 */
describe('fetchChangelog', () => {
  it('takes the leading heading as the title and the rest as the body', async () => {
    const data = await fetchChangelog(
      '1.4.189-rc.0',
      '1.4.188',
      '# Manta 的第一个发布\n\n桌面端五个切片。\n\n- 自建中继\n- 中文界面'
    )

    expect(data?.release.title).toBe('Manta 的第一个发布')
    expect(data?.release.description).toBe('桌面端五个切片。\n• 自建中继\n• 中文界面')
  })

  it('falls back to the version when the notes open with prose', async () => {
    const data = await fetchChangelog('2.0.0', '1.9.0', 'Fixes a crash on startup.')

    expect(data?.release.title).toBe('v2.0.0')
    expect(data?.release.description).toBe('Fixes a crash on startup.')
  })

  it('points at the release for the version being offered', async () => {
    const data = await fetchChangelog('1.4.189-rc.0', '1.4.188', 'Something changed.')

    expect(data?.release.releaseNotesUrl).toContain('v1.4.189-rc.0')
  })

  it('joins the per-version notes electron-updater sometimes sends as an array', async () => {
    const data = await fetchChangelog('3.0.0', '2.0.0', [
      { version: '3.0.0', note: 'Newest first.' },
      { version: '2.5.0', note: 'Then this.' }
    ])

    expect(data?.release.description).toBe('Newest first.\nThen this.')
  })

  // Nothing renders Markdown here — the card is plain text with `pre-line`.
  it('strips markup instead of showing it', async () => {
    const data = await fetchChangelog(
      '1.0.0',
      '0.9.0',
      '- **Bold** and `code` and [a link](https://example.com/very/long/url)'
    )

    expect(data?.release.description).toBe('• Bold and code and a link')
  })

  // electron-updater falls back to the GitHub release body, which is HTML.
  it('strips the HTML of the release-body fallback', async () => {
    const data = await fetchChangelog('1.0.0', '0.9.0', '<p>Fixed a <em>crash</em>.</p>')

    expect(data?.release.description).toBe('Fixed a crash.')
  })

  // Markdown hard-wraps mid-span, so a code span or link routinely straddles a
  // break. Stripping per line left the stray delimiters behind in the card.
  it('strips markup that straddles a hard wrap', async () => {
    const data = await fetchChangelog(
      '1.0.0',
      '0.9.0',
      '- Run `brew tap paidaxingyo666/manta\n  https://github.com/paidaxingyo666/Manta` first'
    )

    expect(data?.release.description).toBe(
      '• Run brew tap paidaxingyo666/manta https://github.com/paidaxingyo666/Manta first'
    )
  })

  it('strips a link whose target is on the next line', async () => {
    const data = await fetchChangelog(
      '1.0.0',
      '0.9.0',
      'See [the guide](https://example.com/a/\nvery/long/path) for more'
    )

    expect(data?.release.description).toBe('See the guide for more')
  })

  // Markdown hard-wraps at ~80 columns and the card wraps on its own, so every
  // authored break left in place reads as a torn column.
  it('folds a hard-wrapped paragraph back into one line', async () => {
    const data = await fetchChangelog(
      '1.0.0',
      '0.9.0',
      'The updater now reads its notes\nfrom the manifest it already\ndownloaded.'
    )

    expect(data?.release.description).toBe(
      'The updater now reads its notes from the manifest it already downloaded.'
    )
  })

  // A space between two CJK characters is a visible defect, not a word gap.
  it('folds CJK lines without inserting spaces', async () => {
    const data = await fetchChangelog('1.0.0', '0.9.0', '手机端靠它连回不在\n同一网络的桌面端。')

    expect(data?.release.description).toBe('手机端靠它连回不在同一网络的桌面端。')
  })

  it('keeps a blank line from gluing two paragraphs together', async () => {
    const data = await fetchChangelog('1.0.0', '0.9.0', 'First para.\n\nSecond para.')

    expect(data?.release.description).toBe('First para.\nSecond para.')
  })

  // Section headings are what separates "what changed" from "what is still
  // broken"; dropping them silently merged the two.
  it('keeps section headings below the title', async () => {
    const data = await fetchChangelog(
      '1.0.0',
      '0.9.0',
      '# Release\n\n## What changed\n\n- A fix\n\n## Known gaps\n\n- A gap'
    )

    expect(data?.release.title).toBe('Release')
    expect(data?.release.description).toBe('What changed\n• A fix\nKnown gaps\n• A gap')
  })

  // The card does not scroll, so anything past this is invisible.
  it('truncates a body longer than the card can show', async () => {
    const data = await fetchChangelog('1.0.0', '0.9.0', 'x'.repeat(900))

    expect(data?.release.description).toHaveLength(400)
    expect(data?.release.description.endsWith('…')).toBe(true)
  })

  it('cuts on a line break rather than mid-word', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => `- Entry number ${i} with some text`)
    const data = await fetchChangelog('1.0.0', '0.9.0', lines.join('\n'))

    const description = data?.release.description ?? ''
    expect(description.length).toBeLessThanOrEqual(400)
    expect(description.endsWith('…')).toBe(true)
    // Every line except the truncated marker survived whole.
    for (const line of description.replace(/…$/, '').split('\n')) {
      expect(line).toMatch(/^• Entry number \d+ with some text$/)
    }
  })

  // Every one of these used to cost a five-second timeout before producing the
  // same nothing. The plain card is the correct outcome; only the wait was not.
  it.each([
    ['no notes at all', undefined],
    ['an explicit null', null],
    ['an empty string', ''],
    ['only whitespace', '   \n\n  '],
    ['a heading with no body', '# Release 1.0'],
    ['an empty array', []]
  ])('stays plain given %s', async (_label, notes) => {
    expect(await fetchChangelog('1.0.0', '0.9.0', notes)).toBeNull()
  })

  // Upstream's feed gated on a screenshot being present, so a release with good
  // prose and no media showed the plain card. Prose is the bar now.
  it('shows a release that has no media', async () => {
    const data = await fetchChangelog('1.0.0', '0.9.0', '# Title\nBody with no screenshot.')

    expect(data?.release.mediaUrl).toBeUndefined()
    expect(data?.release.description).toBe('Body with no screenshot.')
  })

  // One manifest describes one release, so the card cannot count skipped ones.
  it('does not claim to know how many releases were skipped', async () => {
    const data = await fetchChangelog('1.0.0', '0.1.0', 'Body.')

    expect(data?.releasesBehind).toBeNull()
  })
})
