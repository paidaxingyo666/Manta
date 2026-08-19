import type { MobileE2EEV2Hello, MobileE2EEV2Ready } from './mobile-e2ee-v2-contract'

function repeatedByteBase64(byte: number): string {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(byte)))
}

export function createMobileE2EEV2Fixture(): {
  hello: MobileE2EEV2Hello
  ready: MobileE2EEV2Ready
  sharedSecret: Uint8Array
} {
  const context = {
    protocol: 'manta-mobile-e2ee' as const,
    initiator: 'mobile' as const,
    responder: 'desktop' as const,
    transport: 'relay' as const,
    relayHostId: 'AbCdEf0123_-xyZ9'
  }
  return {
    hello: {
      type: 'e2ee_hello',
      v: 2,
      clientPublicKeyB64: repeatedByteBase64(1),
      clientNonceB64: repeatedByteBase64(2),
      capabilities: { framing: [2], payloadKinds: ['text', 'binary'] },
      context
    },
    ready: {
      type: 'e2ee_ready',
      v: 2,
      desktopPublicKeyB64: repeatedByteBase64(3),
      clientNonceB64: repeatedByteBase64(2),
      desktopNonceB64: repeatedByteBase64(4),
      selection: { framing: 2, payloadKinds: ['text', 'binary'] },
      context
    },
    sharedSecret: new Uint8Array(32).fill(5)
  }
}

export const MOBILE_E2EE_V2_VECTOR = {
  transcriptLength: 1350,
  transcriptHashHex: '8b753bbe20d4484b6623038ab4f2f5545e4c82bcb579d1ed5f2149372f3ac6c9',
  mobileToDesktopKeyHex: '71ceacaf90e9fbd73dc400dd048e43685a8b037c0ab1cc5819dcaf6407afdd4e',
  desktopToMobileKeyHex: 'bf09cd57647999f833978aeab2fdd944ff0eacebd0f63630cfb602754820f890',
  sessionIdHex: 'faaa83ce5c08e5079b83458995c5ecf0c7f8b8703ee9afac77f5109e73f5402b'
} as const
