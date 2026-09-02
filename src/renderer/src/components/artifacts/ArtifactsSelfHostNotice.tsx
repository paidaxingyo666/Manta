import { translate } from '@/i18n/i18n'

/**
 * Upstream runs the artifact host; this fork does not. Publishing still works,
 * but only against a server the operator brings themselves — so the failure a
 * user hits by default is a network error against a domain nobody serves, with
 * nothing on screen to explain why.
 *
 * Deliberately stated rather than derived: the API origin is chosen in the main
 * process from an env var with no IPC to the renderer, and the sentence below is
 * true whether or not that var is set.
 */
export function ArtifactsSelfHostNotice({
  className = ''
}: {
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={`rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 ${className}`}
    >
      {translate(
        'auto.components.artifacts.ArtifactsSelfHostNotice.body',
        'This self-hosted build ships no artifact service. Publishing uploads to whatever MANTA_ARTIFACTS_API_URL points at; leave it unset and links are created against a host this fork does not run, so the upload fails. Run your own and set the variable, or keep sharing off.'
      )}
    </div>
  )
}
