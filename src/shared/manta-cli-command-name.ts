export function getMantaCliCommandNameForPlatform(platform: NodeJS.Platform): string {
  if (platform === 'linux') {
    return 'manta-ide'
  }
  if (platform === 'win32') {
    return 'manta.cmd'
  }
  return 'manta'
}
