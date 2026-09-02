import type { ConnectionPresentationModel } from './use-mobile-tasks-connection-presentation'
import { Pressable, Text } from './mobile-tasks-dependencies'
import { styles } from './mobile-tasks-legacy-styles'
import { translate } from '../i18n/i18n'

export function renderMobileTasksLinearViewControls(model: ConnectionPresentationModel) {
  const {
    linearConnected,
    linearFilterLabel,
    linearGroupLabel,
    linearOrderLabel,
    linearTeamLabel,
    linearViewLabel,
    linearWorkspaceLabel,
    linearWorkspaces,
    provider,
    setShowLinearDisplayPicker,
    setShowLinearFilterPicker,
    setShowLinearGroupPicker,
    setShowLinearOrderPicker,
    setShowLinearTeamPicker,
    setShowLinearViewPicker,
    setShowLinearWorkspacePicker,
    taskUiReady
  } = model
  return (
    provider === 'linear' &&
    linearConnected && (
      <>
        {linearWorkspaces.length > 1 ? (
          <Pressable
            style={styles.segmentButton}
            disabled={!taskUiReady}
            onPress={() => {
              if (!taskUiReady) {
                return
              }
              setShowLinearWorkspacePicker(true)
            }}
          >
            <Text style={styles.segmentSecondaryText}>{linearWorkspaceLabel}</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={styles.segmentButton}
          disabled={!taskUiReady}
          onPress={() => {
            if (!taskUiReady) {
              return
            }
            setShowLinearTeamPicker(true)
          }}
        >
          <Text style={styles.segmentSecondaryText}>{linearTeamLabel}</Text>
        </Pressable>
        <Pressable
          style={styles.segmentButton}
          disabled={!taskUiReady}
          onPress={() => {
            if (!taskUiReady) {
              return
            }
            setShowLinearFilterPicker(true)
          }}
        >
          <Text style={styles.segmentSecondaryText}>{linearFilterLabel}</Text>
        </Pressable>
        <Pressable
          style={styles.segmentButton}
          disabled={!taskUiReady}
          onPress={() => {
            if (!taskUiReady) {
              return
            }
            setShowLinearViewPicker(true)
          }}
        >
          <Text style={styles.segmentSecondaryText}>{linearViewLabel}</Text>
        </Pressable>
        <Pressable
          style={styles.segmentButton}
          disabled={!taskUiReady}
          onPress={() => {
            if (!taskUiReady) {
              return
            }
            setShowLinearGroupPicker(true)
          }}
        >
          <Text style={styles.segmentSecondaryText}>
            {translate('m.tasks.7f859ab9ca', 'Group:')}
            {linearGroupLabel}
          </Text>
        </Pressable>
        <Pressable
          style={styles.segmentButton}
          disabled={!taskUiReady}
          onPress={() => {
            if (!taskUiReady) {
              return
            }
            setShowLinearOrderPicker(true)
          }}
        >
          <Text style={styles.segmentSecondaryText}>
            {translate('m.tasks.a166aa9578', 'Order:')}
            {linearOrderLabel}
          </Text>
        </Pressable>
        <Pressable
          style={styles.segmentButton}
          disabled={!taskUiReady}
          onPress={() => {
            if (!taskUiReady) {
              return
            }
            setShowLinearDisplayPicker(true)
          }}
        >
          <Text style={styles.segmentSecondaryText}>
            {translate('m.tasks.9e23121b07', 'Display')}
          </Text>
        </Pressable>
      </>
    )
  )
}
