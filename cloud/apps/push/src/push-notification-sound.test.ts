import { expect, it } from 'vitest'
import { apnsBody } from './apns-client.js'
import { fcmMessageBody } from './fcm-client.js'
import { buildPushDelivery } from './push-delivery-message.js'
import { PushNotificationSchema } from '@manta-cloud/push-contract'

it('carries a silent preference through validation to APNs and Android payloads', () => {
  const notification = PushNotificationSchema.parse({
    notificationSeq: 1,
    notificationEpoch: 'epoch',
    source: 'terminal-bell',
    agentState: null,
    title: 'Bell',
    body: '',
    sound: false
  })
  const delivery = buildPushDelivery({
    registrationId: 'reg',
    hostFingerprint: 'host',
    notification,
    title: 'Bell',
    body: '',
    coalescedCount: 1
  })
  expect(JSON.parse(apnsBody(delivery)).aps).not.toHaveProperty('sound')
  expect(
    JSON.parse(fcmMessageBody({ delivery, token: 'test-token', channelId: 'manta-desktop' })).message
      .android.notification.channel_id
  ).toBe('manta-desktop-silent')
  expect(JSON.parse(apnsBody({ ...delivery, sound: undefined })).aps.sound).toBe('default')
})
