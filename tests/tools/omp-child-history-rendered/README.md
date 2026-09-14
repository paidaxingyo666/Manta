# Child history resume proof

Run `MANTA_BACKGROUND_LAUNCH=1 node tests/tools/omp-child-history-rendered/run.mjs`.
The hidden Electron fixture renders production subagent rows and styles with injected
OMP, Claude and empty OMP transcripts. It verifies only the independently resumable
OMP child offers resume and that clicking forwards that child's identity and folder
target. CDP screenshots and native visibility assertions are saved in `.bench-fixtures`.
This exercises the affordance and callback, not the complete terminal launch UI.

Run `MANTA_BACKGROUND_LAUNCH=1 bun tests/tools/omp-child-session-resume-smoke.mjs /path/to/oh-my-pi`
for a zero-model-call check against real OMP session storage and CLI parsing. The smoke
builds Manta's path-based resume command, creates parent and nested child transcripts,
and verifies OMP selects the child's distinct identity in a folder workspace.
