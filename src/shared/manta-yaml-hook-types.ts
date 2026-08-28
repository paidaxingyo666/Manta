export type SetupRunPolicy = 'ask' | 'run-by-default' | 'skip-by-default'
export type SetupAgentStartupPolicy = 'start-immediately' | 'wait-for-setup'
export type HookCommandSourcePolicy = 'shared-only' | 'local-only' | 'run-both'

// ─── Hooks (manta.yaml) ──────────────────────────────────────────────
export type MantaHooks = {
  scripts: {
    setup?: string // Runs after worktree is created
    archive?: string // Runs before worktree is archived
  }
  issueCommand?: string // Shared default command for linked GitHub issues
  defaultTabs?: MantaDefaultTabTemplate[] // Terminal tabs to create once for a new worktree
  environmentRecipes?: MantaVmRecipe[] // Project-scoped per-workspace environment recipes
  environmentRecipeDiagnostics?: MantaVmRecipeDiagnostic[] // Non-fatal validation issues from environmentRecipes
  worktree?: MantaWorktreeDefaults // Project-scoped defaults applied when a worktree is created
}

export type MantaWorktreeDefaults = {
  // Why: shared (symlinked) rather than copied — large rebuildable dirs like
  // node_modules should be one install serving every worktree.
  sharedDirectories?: string[]
}

export type MantaDefaultTabTemplate = {
  title?: string
  color?: string
  command?: string
}

export type EphemeralVmCheckoutMode = 'manta-worktree' | 'provisioned-root'

export type MantaVmRecipe = {
  id: string
  name: string
  create: string
  checkoutMode?: EphemeralVmCheckoutMode
  description?: string
  suspend?: string
  resume?: string
  destroy?: string
  destroyDisabled?: boolean
}

export type MantaVmRecipeDiagnostic = {
  index: number
  field?: string
  message: string
}

export type RepoHookSettings = {
  // Why: persisted data may still include the old mode field from the earlier
  // hook UI. Keep it in the shape so existing local state reads without a migration.
  mode: 'auto' | 'override'
  setupRunPolicy?: SetupRunPolicy
  setupAgentStartupPolicy?: SetupAgentStartupPolicy
  commandSourcePolicy?: HookCommandSourcePolicy
  scripts: {
    setup: string
    archive: string
  }
}

export type PersistedTrustedMantaHookEntry = {
  contentHash: string
  approvedAt: number
}

export type PersistedTrustedMantaHookRepo = {
  all?: {
    approvedAt: number
  }
  setup?: PersistedTrustedMantaHookEntry
  archive?: PersistedTrustedMantaHookEntry
  issueCommand?: PersistedTrustedMantaHookEntry
  vmRecipe?: PersistedTrustedMantaHookEntry
}

export type PersistedTrustedMantaHooks = Record<string, PersistedTrustedMantaHookRepo>
