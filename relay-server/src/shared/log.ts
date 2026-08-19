/**
 * Structured logging.
 *
 * Lines are JSON so an operator can ship them straight into journald or a log
 * collector. Every field passes through a redactor keyed on its *name*: the
 * easiest way to leak a resume token is to log a whole control message while
 * debugging, and a relay that leaks credentials into a log file is worse than
 * one that logs nothing.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/** Field names whose values are credentials. Matched case-insensitively. */
const SECRET_KEY = /(token|secret|credential|proof|password|authorization|cookie)/i

/** Deliberately allowed: these are public identifiers, not credentials. */
const PUBLIC_KEY = /^(relayHostId|relayDeviceId|connId|reqId|hostPublicKeyB64|challengeId)$/

export type LogFields = Record<string, unknown>

function redactValue(key: string, value: unknown): unknown {
  if (!PUBLIC_KEY.test(key) && SECRET_KEY.test(key)) {
    return '[redacted]'
  }
  if (value instanceof Error) {
    return value.message
  }
  if (typeof value === 'string' && value.length > 512) {
    return `${value.slice(0, 512)}…`
  }
  if (Array.isArray(value)) {
    // Arrays are the easy way to smuggle a credential past a redactor that only
    // walks objects: {batch:[{refreshToken:'…'}]}.
    return value.map((item) => redactValue(key, item))
  }
  if (value && typeof value === 'object') {
    return redactFields(value as LogFields)
  }
  return value
}

function redactFields(fields: LogFields): LogFields {
  const out: LogFields = {}
  for (const [key, value] of Object.entries(fields)) {
    out[key] = redactValue(key, value)
  }
  return out
}

export class Logger {
  constructor(
    private readonly minimum: LogLevel = 'info',
    private readonly write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
    private readonly now: () => number = () => Date.now()
  ) {}

  private emit(level: LogLevel, event: string, fields?: LogFields): void {
    if (ORDER[level] < ORDER[this.minimum]) {
      return
    }
    const record = {
      ts: new Date(this.now()).toISOString(),
      level,
      event,
      ...(fields ? redactFields(fields) : {})
    }
    try {
      this.write(JSON.stringify(record))
    } catch {
      // Logging must never take the relay down.
    }
  }

  debug(event: string, fields?: LogFields): void {
    this.emit('debug', event, fields)
  }
  info(event: string, fields?: LogFields): void {
    this.emit('info', event, fields)
  }
  warn(event: string, fields?: LogFields): void {
    this.emit('warn', event, fields)
  }
  error(event: string, fields?: LogFields): void {
    this.emit('error', event, fields)
  }
}

export function isLogLevel(value: string): value is LogLevel {
  return value in ORDER
}
