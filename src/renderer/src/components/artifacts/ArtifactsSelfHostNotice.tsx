import { translate } from '@/i18n/i18n'

/**
 * Upstream runs the artifact host; this fork does not. Publishing still works,
 * but only against a server the operator brings themselves — so the failure a
 * user hits by default is a network error against a domain nobody serves, with
 * nothing on screen to explain why.
 *
 * Deliberately stated rather than derived: the origin is resolved in the main
 * process, and the sentence below is true whether or not it has been set. It
 * names where to set it, because the answer used to be an environment variable
 * a packaged app never sees.
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
        'This build ships no artifact service of its own. Publishing goes to the artifact host set under Manta Cloud → Configure endpoints; leave it empty and links are created against a host nobody runs, so the upload fails. A self-hosted relay can serve one — see its README — or keep sharing off.'
      )}
    </div>
  )
}
