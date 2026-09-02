import { Pressable, Text, View } from 'react-native'
import type { WorkspaceSshGate } from '../tasks/workspace-ssh-gate'
import { workspaceSshStatusLabel } from '../tasks/workspace-ssh-gate'
import { newWorktreeFormStyles as styles } from './new-worktree-form-styles'
import { translate } from '../i18n/i18n'

export function NewWorkspaceSshConnectionField({
  repoName,
  sshGate,
  onConnect
}: {
  repoName: string
  sshGate: WorkspaceSshGate
  onConnect: () => void
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {translate('m.NewWorktreeModal.24d0c3cf77', 'SSH Connection')}
      </Text>
      <View style={styles.sshBox}>
        <View style={styles.sshRow}>
          <View
            style={[
              styles.sshDot,
              sshGate.status === 'connected'
                ? styles.sshDotConnected
                : sshGate.connectInProgress
                  ? styles.sshDotProgress
                  : styles.sshDotDisconnected
            ]}
          />
          <View style={styles.sshCopy}>
            <Text style={styles.sshTitle} numberOfLines={1}>
              {repoName}
            </Text>
            <Text style={styles.sshSubtitle}>{workspaceSshStatusLabel(sshGate.status)}</Text>
          </View>
          {sshGate.status === 'connected' ? null : (
            <Pressable
              style={[styles.sshConnectButton, sshGate.connectInProgress && styles.disabled]}
              disabled={sshGate.connectInProgress}
              onPress={onConnect}
            >
              <Text style={styles.sshConnectText}>
                {sshGate.connectInProgress
                  ? translate('m.NewWorktreeModal.a2ba0ebe73', 'Connecting...')
                  : translate('m.NewWorktreeModal.3bddecbdf9', 'Connect')}
              </Text>
            </Pressable>
          )}
        </View>
        {sshGate.error ? <Text style={styles.errorInline}>{sshGate.error}</Text> : null}
      </View>
    </View>
  )
}
