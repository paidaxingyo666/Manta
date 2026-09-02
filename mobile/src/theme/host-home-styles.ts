/**
 * Styles for a host's workspace list screen.
 *
 * Split in two — the chrome around the list, and the list and its filter
 * modal — because one object of both exceeded the file's line budget.
 */
import { chromeStyles } from './host-home-chrome-styles'
import { listStyles } from './host-home-list-styles'

export const styles = { ...chromeStyles, ...listStyles }
