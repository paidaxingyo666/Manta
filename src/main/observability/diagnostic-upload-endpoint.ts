// Build-time diagnostic upload routing. Kept outside ipc/diagnostics.ts so
// crash reporting can attach logs through the same pinned endpoint rules.

export function resolveDiagnosticBuildTokenEndpoint(): string | null {
  const endpoint =
    typeof MANTA_DIAGNOSTICS_TOKEN_URL !== 'undefined'
      ? MANTA_DIAGNOSTICS_TOKEN_URL
      : ((globalThis as { MANTA_DIAGNOSTICS_TOKEN_URL?: string | null })
          .MANTA_DIAGNOSTICS_TOKEN_URL ?? null)
  return typeof endpoint === 'string' && endpoint.length > 0 ? endpoint : null
}

export function resolveDiagnosticBuildIdentity(): 'stable' | 'rc' | null {
  const ident =
    typeof MANTA_BUILD_IDENTITY !== 'undefined'
      ? MANTA_BUILD_IDENTITY
      : ((globalThis as { MANTA_BUILD_IDENTITY?: 'stable' | 'rc' | null }).MANTA_BUILD_IDENTITY ??
        null)
  return ident === 'stable' || ident === 'rc' ? ident : null
}

export function resolveDiagnosticTokenEndpoint(): string | null {
  const buildEndpoint = resolveDiagnosticBuildTokenEndpoint()
  // Official builds must stay pinned to the CI-substituted endpoint; user env
  // cannot redirect uploads that the UI labels as going to Manta support.
  if (resolveDiagnosticBuildIdentity()) {
    return buildEndpoint
  }
  const fromEnv = process.env.MANTA_DIAGNOSTICS_TOKEN_URL
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv
  }
  return buildEndpoint
}

export function resolveDiagnosticMantaChannel(): 'stable' | 'rc' | 'dev' {
  const ident = resolveDiagnosticBuildIdentity()
  if (ident === 'stable' || ident === 'rc') {
    return ident
  }
  return 'dev'
}
