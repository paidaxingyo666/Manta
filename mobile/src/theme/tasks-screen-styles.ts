/**
 * Styles for the tasks screen.
 *
 * The screen has 250 style keys — one object of them runs several times a
 * file's line budget, so they are declared in parts in source order and
 * recombined here. Splitting them by name was not an option: 150 of the
 * keys share no prefix with anything else.
 */
import { tasksStyles1 } from './tasks-screen-styles-1'
import { tasksStyles2 } from './tasks-screen-styles-2'
import { tasksStyles3 } from './tasks-screen-styles-3'
import { tasksStyles4 } from './tasks-screen-styles-4'
import { tasksStyles5 } from './tasks-screen-styles-5'
import { tasksStyles6 } from './tasks-screen-styles-6'

export const styles = {
  ...tasksStyles1,
  ...tasksStyles2,
  ...tasksStyles3,
  ...tasksStyles4,
  ...tasksStyles5,
  ...tasksStyles6
}

export function getPrSignalToneStyle(tone: 'neutral' | 'success' | 'warning' | 'danger') {
  if (tone === 'success') {
    return styles.prSignalSuccess
  }
  if (tone === 'warning') {
    return styles.prSignalWarning
  }
  if (tone === 'danger') {
    return styles.prSignalDanger
  }
  return null
}

export function getGitLabPipelineStatusStyle(status: string) {
  switch (status) {
    case 'success':
      return styles.pipelineStatusSuccess
    case 'failed':
      return styles.pipelineStatusDanger
    case 'manual':
      return styles.pipelineStatusWarning
    case 'running':
    case 'pending':
    case 'created':
    case 'preparing':
    case 'waiting_for_resource':
    case 'scheduled':
      return styles.pipelineStatusActive
    case 'canceled':
    case 'skipped':
    default:
      return null
  }
}
