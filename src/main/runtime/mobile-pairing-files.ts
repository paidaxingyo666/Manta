export const DEVICE_REGISTRY_FILENAME = 'manta-devices.json'
export const E2EE_KEYPAIR_FILENAME = 'manta-e2ee-keypair.json'

// Migrate these together so device tokens and E2EE material never split across dirs.
export const MOBILE_PAIRING_USERDATA_FILES = [
  DEVICE_REGISTRY_FILENAME,
  E2EE_KEYPAIR_FILENAME
] as const
