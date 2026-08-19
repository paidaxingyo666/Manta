import { track } from '@/lib/telemetry'
import type { EventProps } from '../../../../shared/telemetry-events'

export type MantaCliFeatureTipSource = EventProps<'manta_cli_feature_tip_shown'>['source']
export type MantaCliFeatureTipSetupResult =
  EventProps<'manta_cli_feature_tip_setup_result'>['result']
export type CmdJPaletteFeatureTipSource = EventProps<'cmd_j_palette_feature_tip_shown'>['source']

export function getMantaCliFeatureTipTelemetrySource(value: unknown): MantaCliFeatureTipSource {
  return value === 'app_open' ? 'app_open' : 'manual'
}

export function trackMantaCliFeatureTipShown(source: MantaCliFeatureTipSource): void {
  track('manta_cli_feature_tip_shown', { source })
}

export function trackMantaCliFeatureTipSetupClicked(source: MantaCliFeatureTipSource): void {
  track('manta_cli_feature_tip_setup_clicked', { source })
}

export function trackMantaCliFeatureTipSetupResult(
  source: MantaCliFeatureTipSource,
  result: MantaCliFeatureTipSetupResult
): void {
  track('manta_cli_feature_tip_setup_result', { source, result })
}

export function trackCmdJPaletteFeatureTipShown(source: CmdJPaletteFeatureTipSource): void {
  track('cmd_j_palette_feature_tip_shown', { source })
}

export function trackCmdJPaletteFeatureTipAcknowledged(source: CmdJPaletteFeatureTipSource): void {
  track('cmd_j_palette_feature_tip_acknowledged', { source })
}
