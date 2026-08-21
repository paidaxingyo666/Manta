/**
 * What this build is, for an operator who has to answer "which version is
 * actually running on that host".
 *
 * Baked in at image build time rather than read from package.json at runtime:
 * the runtime stage copies package.json, but a `docker run` against a locally
 * built image needs the same answer, and the git sha is not in package.json at
 * all. Absent values read as 'unknown' rather than crashing a health check.
 */
export type BuildInfo = {
  version: string
  /** Short git sha the image was built from, when the build passed one. */
  revision: string
  /** RFC 3339, set by the image build. */
  builtAt: string
}

export function buildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  return {
    version: env.MANTA_RELAY_VERSION?.trim() || 'dev',
    revision: env.MANTA_RELAY_REVISION?.trim() || 'unknown',
    builtAt: env.MANTA_RELAY_BUILT_AT?.trim() || 'unknown'
  }
}
