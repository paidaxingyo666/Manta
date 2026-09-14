import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '../../../src/renderer/src/components/ui/tooltip'
import { SessionSubagentsSection } from '../../../src/renderer/src/components/right-sidebar/AiVaultSessionSubagents'
import type { AiVaultSession } from '../../../src/shared/ai-vault-types'
import './fixture.css'

const parent: AiVaultSession = {
  id: 'parent',
  agent: 'omp',
  executionHostId: 'local',
  sessionId: 'parent',
  title: 'Coordinate the change',
  cwd: '/project',
  branch: null,
  model: null,
  filePath: '/sessions/parent.jsonl',
  codexHome: null,
  createdAt: null,
  updatedAt: null,
  modifiedAt: '2026-09-14T00:00:00Z',
  messageCount: 2,
  totalTokens: 0,
  previewMessages: [],
  queuedMessageCount: 0,
  subagentTranscriptCount: 3,
  resumeCommand: 'omp --resume parent',
  subagent: null
}
const children: AiVaultSession[] = [
  {
    ...parent,
    id: 'child',
    sessionId: 'child',
    title: 'OMP worker with saved conversation',
    filePath: '/sessions/parent/child.jsonl',
    subagent: { parentSessionId: 'parent', agentType: 'worker', status: 'completed' }
  },
  {
    ...parent,
    id: 'claude',
    agent: 'claude',
    title: 'Claude worker (view only)',
    subagent: { parentSessionId: 'parent', agentType: 'worker', status: 'completed' }
  },
  {
    ...parent,
    id: 'empty',
    sessionId: 'empty',
    messageCount: 0,
    title: 'OMP worker without saved turns',
    subagent: { parentSessionId: 'parent', agentType: 'worker', status: 'stopped' }
  }
]
Object.defineProperty(window, 'api', {
  value: { aiVault: { listSubagentSessions: async () => ({ sessions: children, issues: [] }) } }
})
function App() {
  const [result, setResult] = useState('No resume requested')
  return (
    <TooltipProvider>
      <main className="p-6 bg-background text-foreground space-y-4">
        <h1>Agent Session History</h1>
        <SessionSubagentsSection
          session={parent}
          resume={{
            getState: () => ({
              blocked: false,
              worktreeId: 'folder:project',
              usesSessionWorktree: true
            }),
            onResume: (session, target) => setResult(`Resume ${session.sessionId} in ${target}`)
          }}
        />
        <output>{result}</output>
      </main>
    </TooltipProvider>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
