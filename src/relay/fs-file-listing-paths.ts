import {
  normalizeQuickOpenRgLine,
  shouldExcludeQuickOpenRelPath,
  shouldIncludeQuickOpenPath
} from '../shared/quick-open-filter'
import type { FileInventoryBudget } from '../shared/file-inventory-budget'
import type { QuickOpenPathRanker } from '../shared/quick-open-path-search'

export function retainRelayFileListingPath(
  rawLine: string,
  excludePathPrefixes: readonly string[],
  ranker: QuickOpenPathRanker | null,
  files: Set<string>,
  budget: FileInventoryBudget | null
): boolean {
  const relativePath = normalizeQuickOpenRgLine(rawLine, { kind: 'cwd-relative' })
  if (relativePath === null) {
    return false
  }
  if (
    !shouldIncludeQuickOpenPath(relativePath) ||
    shouldExcludeQuickOpenRelPath(relativePath, excludePathPrefixes)
  ) {
    return true
  }
  if (ranker) {
    ranker.consider(relativePath)
  } else if (!files.has(relativePath)) {
    budget?.record(relativePath)
    files.add(relativePath)
  }
  return true
}
