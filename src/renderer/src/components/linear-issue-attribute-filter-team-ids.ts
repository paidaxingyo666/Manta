import type { LinearTeam } from '../../../shared/linear/workspace-types'

/**
 * Resolve which Linear team ids should feed attribute-filter metadata.
 * Empty selection falls back to the same primary-team default as before;
 * non-empty selection returns every selected team (sorted for stable loads).
 */
export function resolveLinearIssueAttributeFilterTeamIds(options: {
  selectedTeamIds: readonly string[]
  availableTeams: readonly LinearTeam[]
  primaryTeamId: string | null
}): string[] {
  const { selectedTeamIds, availableTeams, primaryTeamId } = options
  const availableIds = new Set(availableTeams.map((team) => team.id))
  const selected = selectedTeamIds.filter((id) => availableIds.has(id))
  if (selected.length > 0) {
    // Stable order: name/id of available teams, not click order — matches primary-team sort.
    const byId = new Map(availableTeams.map((team) => [team.id, team] as const))
    return [...selected].sort((a, b) => {
      const teamA = byId.get(a)
      const teamB = byId.get(b)
      const nameCmp = (teamA?.name ?? a).localeCompare(teamB?.name ?? b)
      if (nameCmp !== 0) {
        return nameCmp
      }
      return a.localeCompare(b)
    })
  }
  if (primaryTeamId && availableIds.has(primaryTeamId)) {
    return [primaryTeamId]
  }
  return []
}

/** Deduplicate metadata rows by id, preserving first-seen order. */
export function unionLinearMetadataById<T extends { id: string }>(groups: readonly T[][]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const group of groups) {
    for (const item of group) {
      if (seen.has(item.id)) {
        continue
      }
      seen.add(item.id)
      out.push(item)
    }
  }
  return out
}

/** One picker row standing for every id that shares a display name. */
export type LinearMetadataNameGroup = { key: string; name: string; ids: string[] }

/**
 * Collapse metadata rows that share a display name. Linear workflow states (and team
 * labels) are per team, so every selected team contributes its own "Todo" id — the app
 * already treats status identity as the name, so the picker must too (#16785).
 */
export function groupLinearMetadataByName<T extends { id: string; name: string }>(
  rows: readonly T[]
): LinearMetadataNameGroup[] {
  const byName = new Map<string, LinearMetadataNameGroup>()
  for (const row of rows) {
    const group = byName.get(row.name)
    if (group) {
      group.ids.push(row.id)
      continue
    }
    // First id doubles as the row key: unique, and stable while metadata is unchanged.
    byName.set(row.name, { key: row.id, name: row.name, ids: [row.id] })
  }
  return [...byName.values()]
}

/**
 * Group keys for the selected ids. An id no loaded group covers — a facet from a team
 * whose metadata is not in yet — passes through as its own key so toggling another row
 * never drops it (R12).
 */
export function selectedLinearMetadataGroupKeys(
  groups: readonly { key: string; ids: readonly string[] }[],
  selectedIds: readonly string[]
): string[] {
  const keyById = new Map<string, string>()
  for (const group of groups) {
    for (const id of group.ids) {
      keyById.set(id, group.key)
    }
  }
  return [...new Set(selectedIds.map((id) => keyById.get(id) ?? id))]
}

/** Every id behind the picked group keys; an unknown key is itself an id. */
export function expandLinearMetadataGroupKeys(
  groups: readonly { key: string; ids: readonly string[] }[],
  keys: readonly string[]
): string[] {
  const idsByKey = new Map(groups.map((group) => [group.key, group.ids] as const))
  return keys.flatMap((key) => [...(idsByKey.get(key) ?? [key])])
}
