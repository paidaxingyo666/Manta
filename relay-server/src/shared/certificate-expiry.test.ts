import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CERTIFICATE_WARN_DAYS, readCertificateStatus } from './certificate-expiry.js'

function selfSigned(days: number): { dir: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), 'manta-cert-'))
  const cert = join(dir, 'cert.pem')
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      cert,
      '-days',
      String(days),
      '-subj',
      '/CN=relay.example.com'
    ],
    { stdio: 'ignore' }
  )
  return { dir, cert }
}

describe('certificate expiry', () => {
  it('reports the days remaining on a real certificate', () => {
    const { dir, cert } = selfSigned(90)
    try {
      const status = readCertificateStatus(cert)
      // openssl rounds to whole days; allow the boundary either side.
      expect(status.daysRemaining).toBeGreaterThanOrEqual(88)
      expect(status.daysRemaining).toBeLessThanOrEqual(90)
      expect(status.subject).toContain('relay.example.com')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('goes negative once the certificate has lapsed', () => {
    // The point of this module is the case nobody notices, so an expired
    // certificate must read as unambiguously past rather than as zero.
    const { dir, cert } = selfSigned(1)
    try {
      const future = new Date(Date.now() + 10 * 86_400_000)
      expect(readCertificateStatus(cert, future).daysRemaining).toBeLessThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails loudly on a path that is not a certificate', () => {
    expect(() => readCertificateStatus('/nonexistent/cert.pem')).toThrow()
  })

  it('warns with enough runway to act', () => {
    // Let's Encrypt renews at 30 days by default; matching it means the warning
    // arrives when a healthy deployment would already have renewed.
    expect(CERTIFICATE_WARN_DAYS).toBe(30)
  })
})
