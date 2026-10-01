import type {
  SshConnectionWorkChannel,
  SshConnectionWorkLedger
} from './ssh-connection-work-ledger'

type TrackableChannel = SshConnectionWorkChannel & {
  closed?: unknown
}

function isTrackableChannel(value: unknown): value is TrackableChannel {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return (
    'on' in value &&
    typeof value.on === 'function' &&
    'once' in value &&
    typeof value.once === 'function' &&
    'removeListener' in value &&
    typeof value.removeListener === 'function'
  )
}

export function openTrackedSshSocket<T extends NodeJS.EventEmitter>(
  ledger: SshConnectionWorkLedger,
  open: () => T
): T {
  const work = ledger.beginChannelOpen()
  try {
    const socket = open()
    trackSshConnectionChannelLifetime(work, socket)
    return socket
  } catch (error) {
    work.markUnverifiable(error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

/** Start tracking before the open callback hands the channel to another owner. */
export function trackSshConnectionChannelLifetime(
  work: ReturnType<SshConnectionWorkLedger['beginChannelOpen']>,
  value: unknown
): void {
  if (!isTrackableChannel(value)) {
    work.markUnverifiable(new Error('ssh_connection_channel_lifetime_unverifiable'))
    return
  }
  const channel = value
  work.bind(channel)
  if (channel.closed === true) {
    work.close()
    return
  }
  const onError = (error: Error) => work.markUnverifiable(error)
  channel.on('error', onError)
  channel.once('close', () => {
    channel.removeListener('error', onError)
    work.close()
  })
}
