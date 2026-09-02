/**
 * Certificate expiry reporting.
 *
 * The relay does not terminate TLS — a reverse proxy in front of it does — so
 * it has no way to notice that the certificate it is served behind is about to
 * lapse. That is normally fine, because the proxy renews automatically.
 *
 * It is not fine when renewal is blocked. This deployment reaches Let's Encrypt
 * but cannot answer an HTTP-01 or TLS-ALPN-01 challenge, because the ports
 * those use are hijacked upstream while the domain is unfiled. The certificate
 * therefore has a fixed end date and no automatic path past it, and the failure
 * mode is silent: everything works until the day it does not.
 *
 * So: point MANTA_RELAY_TLS_CERT_PATH at the certificate the proxy serves and
 * the relay will report how long is left, as a metric and as a log line that
 * gets louder as the date approaches.
 */
import { readFileSync } from 'node:fs'
import { X509Certificate } from 'node:crypto'
import type { Logger } from './log.js'
import type { Metrics } from '../metrics.js'

export type CertificateStatus = {
  notAfter: Date
  daysRemaining: number
  subject: string
}

export function readCertificateStatus(path: string, now = new Date()): CertificateStatus {
  const cert = new X509Certificate(readFileSync(path))
  const notAfter = new Date(cert.validTo)
  if (Number.isNaN(notAfter.getTime())) {
    throw new Error(`certificate at ${path} has an unreadable validity date`)
  }
  return {
    notAfter,
    daysRemaining: Math.floor((notAfter.getTime() - now.getTime()) / 86_400_000),
    subject: cert.subject
  }
}

/** Under this, the operator needs to have already started renewing. */
export const CERTIFICATE_WARN_DAYS = 30

/**
 * Reports the certificate's remaining life now and once a day.
 *
 * Returns a stop function. A no-op when no path is configured, which is the
 * normal case — this only earns its keep where renewal cannot happen on its own.
 */
export function startCertificateWatch(
  path: string | null,
  metrics: Metrics,
  logger: Logger
): () => void {
  if (!path) {
    return () => {}
  }
  const check = (): void => {
    try {
      const status = readCertificateStatus(path)
      metrics.gauge(
        'manta_relay_certificate_expires_in_days',
        'Days until the served TLS certificate expires.',
        status.daysRemaining
      )
      const fields = {
        subject: status.subject,
        notAfter: status.notAfter.toISOString(),
        daysRemaining: status.daysRemaining
      }
      if (status.daysRemaining < 0) {
        logger.error('tls.certificate_expired', fields)
      } else if (status.daysRemaining <= CERTIFICATE_WARN_DAYS) {
        logger.warn('tls.certificate_expiring', fields)
      } else {
        logger.info('tls.certificate', fields)
      }
    } catch (error) {
      logger.warn('tls.certificate_unreadable', { error, path })
    }
  }
  check()
  const timer = setInterval(check, 24 * 60 * 60_000)
  timer.unref?.()
  return () => clearInterval(timer)
}
