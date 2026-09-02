import type { ProviderViewProjectionModel } from './use-mobile-tasks-provider-view-projection'
import { classifyConnection } from './mobile-tasks-dependencies'
import { translate } from '../i18n/i18n'

export function useMobileTasksConnectionPresentation(model: ProviderViewProjectionModel) {
  const {
    connState,
    githubMode,
    lastConnectedAt,
    provider,
    query,
    reconnectAttempts,
    relayRecovery
  } = model
  const headerVerdict = classifyConnection({
    state: connState,
    reconnectAttempts,
    lastConnectedAt,
    ...relayRecovery
  })
  const emptyLabel =
    connState !== 'connected'
      ? translate('m.tasks.43d60ddc79', 'Connect to a host to load tasks')
      : query
        ? translate('m.tasks.38291ebaa5', 'No matching tasks')
        : provider === 'github'
          ? translate('m.tasks.85a194d9e6', 'No GitHub tasks')
          : provider === 'gitlab'
            ? translate('m.tasks.89fb848688', 'No GitLab tasks')
            : translate('m.tasks.b862e0e556', 'No Linear tasks')
  const isGithubProjectSearch = provider === 'github' && githubMode === 'project'
  return Object.assign(model, { headerVerdict, emptyLabel, isGithubProjectSearch })
}

export type ConnectionPresentationModel = ReturnType<typeof useMobileTasksConnectionPresentation>
