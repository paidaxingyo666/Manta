import { MobileNotificationReplayBuffer } from './mobile-notification-replay'
import { notifyRuntimeListeners } from './runtime-async-boundaries'
import { getRuntimeDesktopSurface } from './runtime-desktop-surface'

export type MobileNotificationDispatchEvent = {
  type: 'notification'
  source: 'agent-task-complete' | 'terminal-bell' | 'test' | 'plugin'
  title: string
  body: string
  worktreeId?: string
  notificationId?: string
  notificationSeq?: number
  notificationEpoch?: string
}

export type MobileNotificationDismissEvent = {
  type: 'dismiss'
  notificationId: string
  notificationSeq?: number
  notificationEpoch?: string
}

export type MobileNotificationEvent =
  | MobileNotificationDispatchEvent
  | MobileNotificationDismissEvent

export class RuntimeMobileNotificationController {
  private readonly listeners = new Set<(event: MobileNotificationEvent) => void>()
  private readonly replay = new MobileNotificationReplayBuffer()
  private pushEscalation: { schedule: (event: MobileNotificationEvent) => void } | null = null

  setPushEscalation(escalation: { schedule: (event: MobileNotificationEvent) => void }): void {
    this.pushEscalation = escalation
  }

  onDispatched(listener: (event: MobileNotificationEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getListenerCount(): number {
    return this.listeners.size
  }

  dispatch(event: MobileNotificationEvent): void {
    const seq = this.replay.record(event)
    const sequenced = {
      ...event,
      notificationSeq: seq,
      notificationEpoch: this.replay.epoch
    }
    // Scheduling must not delay or throw into live delivery.
    this.pushEscalation?.schedule(sequenced)
    notifyRuntimeListeners(this.listeners, (listener) => listener(sequenced), 'mobile-notification')
  }

  getMissedSince(lastSeenSeq: number, epoch?: string) {
    return this.replay.getMissedSince(lastSeenSeq, epoch)
  }

  getEpoch(): string {
    return this.replay.epoch
  }

  dismiss(notificationId: string): void {
    this.dispatch({ type: 'dismiss', notificationId })
  }

  async dispatchPlugin(input: {
    pluginId: string
    title: string
    body?: string
  }): Promise<{ delivered: boolean }> {
    const title = `${input.pluginId}: ${input.title}`
    const body = input.body ?? ''
    let delivered = false
    try {
      delivered = getRuntimeDesktopSurface().showNotification({ title, body })
    } catch {
      // Headless runtimes still relay the notification to mobile clients.
    }
    this.dispatch({ type: 'notification', source: 'plugin', title, body })
    return { delivered }
  }
}
