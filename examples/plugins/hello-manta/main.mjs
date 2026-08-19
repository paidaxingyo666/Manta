// Sample Manta plugin worker entry. Runs inside the out-of-process plugin
// worker (plain Node, no Electron), forked lazily on the first trigger. The
// default export receives the `manta` API: command registration, event
// handlers, and the capability-gated host API.
export default function activate(manta) {
  manta.commands.register('hello-ping', async (args) => {
    const stored = await manta.host.call('storage.get', { key: 'pings' })
    const count = (typeof stored?.value === 'number' ? stored.value : 0) + 1
    await manta.host.call('storage.set', { key: 'pings', value: count })
    return { pong: true, count, args: args ?? null }
  })

  manta.events.on('worktree.created', async (payload) => {
    manta.log(`worktree created: ${payload.worktreeId} at ${payload.path}`)
    await manta.host.call('notifications.show', {
      title: 'Worktree created',
      body: payload.path
    })
  })

  manta.events.on('agent.status.changed', (payload) => {
    manta.log(`agent status: ${payload.state} in ${payload.worktreeId ?? 'unknown worktree'}`)
  })
}
