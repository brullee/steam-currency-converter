#!/usr/bin/env node
// PreToolUse hook on Bash: Claude never pushes - the user pushes. Blocks `git push` in any
// form (git -C dir push, chained after &&, inside bash -c or $(...)) and any npm script
// whose definition pushes, like `npm run deploy:patch`. Only Claude's tool calls go
// through this hook; pushing from your own terminal is unaffected.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { allCommands, deny, extractHeredocs, gitSubcommand, program, readHookInput } from './lib/shell.mjs'

const REASON = "Blocked: Claude doesn't push. The commits are ready locally - tell the user and let them push."

const input = readHookInput()
const raw = input.tool_input?.command ?? ''

try {
  const pushingScripts = new Set()
  try {
    const pkg = JSON.parse(readFileSync(join(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? '.', 'package.json'), 'utf8'))
    for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
      if (/\bgit\b[^&;|]*\bpush\b/.test(script)) pushingScripts.add(name)
    }
  } catch { /* no package.json - only git itself to check */ }

  for (const words of allCommands(extractHeredocs(raw).command)) {
    const git = gitSubcommand(words)
    if (git?.sub === 'push' || (git?.sub === 'subtree' && git.args.includes('push'))) deny(REASON)

    const p = program(words)
    if (p?.name === 'npm' && ['run', 'run-script'].includes(p.args[0]) && pushingScripts.has(p.args[1])) {
      deny(`Blocked: \`npm run ${p.args[1]}\` runs git push. ${REASON}`)
    }
  }
} catch {
  // If parsing ever breaks, fail closed on anything that looks like a push.
  if (/\bgit\b[^\n]*\bpush\b/.test(raw)) deny(REASON)
}
