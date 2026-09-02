import type { PRCommentAudienceFilter } from '../../../../src/shared/pr-comment-audience'
import { localizedConstant } from '../../i18n/localized-constant'
import { translate } from '../../i18n/i18n'

export const prCommentAudienceFilters = localizedConstant(
  () =>
    [
      {
        value: 'all',
        label: translate('m.pr.comment.audience.labels.8fabd9b4d4', 'All')
      },
      {
        value: 'human',
        label: translate('m.pr.comment.audience.labels.0964119c2c', 'Humans')
      },
      {
        value: 'bot',
        label: translate('m.pr.comment.audience.labels.92606cad19', 'Bots')
      }
    ] satisfies { value: PRCommentAudienceFilter; label: string }[]
)

export function getPRCommentAudienceEmptyLabel(filter: PRCommentAudienceFilter): string {
  switch (filter) {
    case 'bot':
      return 'No bot comments.'
    case 'human':
      return 'No human comments.'
    case 'all':
      return 'No comments yet.'
  }
}
