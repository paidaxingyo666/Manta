/** Executable entry for `mantad`. See `./mantad-entry.ts`. */
import process from 'node:process'
import { main } from './mantad-entry'

main().catch((error: unknown) => {
  console.error('mantad: failed to start:', error)
  process.exit(1)
})
