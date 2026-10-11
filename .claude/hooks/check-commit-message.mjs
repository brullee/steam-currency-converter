#!/usr/bin/env node
// PreToolUse hook on Bash: keeps Claude's commit messages in this repo's style - a subject
// of at most 72 chars and at most a 2-line body. A longer description usually means the
// change is more than one commit. Also blocks Claude/Anthropic attribution trailers.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { allCommands, deny, extractHeredocs, gitSubcommand, readHookInput } from './lib/shell.mjs'

const MAX_SUBJECT = 72
const MAX_BODY_LINES = 2
const MAX_BODY_LINE = 72
const ATTRIBUTION = /co-authored-by:\s*claude|generated with \[?claude code\]?|noreply@anthropic\.com|claude\.com\/claude-code/i

const input = readHookInput()
const raw = input.tool_input?.command ?? ''
const { command, bodies } = extractHeredocs(raw)
const fillHeredocs = (text) => text.replace(/__HEREDOC_(\d+)__/g, (_m, n) => bodies[n])

// The commit message as git would build it, or null when it can't be known up front
// (editor, -C reuse, unreadable -F file) - those are left alone.
function commitMessage(args, words) {
  const parts = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--') break
    if (a === '-m' || a === '--message' || /^-[a-zA-Z]+m$/.test(a)) parts.push(fillHeredocs(args[++i] ?? ''))
    else if (a.startsWith('--message=')) parts.push(fillHeredocs(a.slice('--message='.length)))
    else if (/^-m./.test(a)) parts.push(fillHeredocs(a.slice(2)))
    else if (a === '-F' || a === '--file' || a.startsWith('--file=')) {
      const file = a.startsWith('--file=') ? a.slice('--file='.length) : args[++i]
      if (file === '-') {
        const stdin = words.map((w) => w.match(/^__STDIN_(\d+)__$/)).find(Boolean)
        if (!stdin) return null
        parts.push(bodies[stdin[1]])
      } else {
        try { parts.push(readFileSync(resolve(input.cwd ?? '.', file ?? ''), 'utf8')) } catch { return null }
      }
    }
  }
  // Like git, separate -m paragraphs with a blank line.
  return parts.length ? parts.join('\n\n') : null
}

for (const words of allCommands(command)) {
  const git = gitSubcommand(words)
  if (git?.sub !== 'commit') continue

  if (ATTRIBUTION.test(raw)) {
    deny("Blocked: the commit message has Claude/Anthropic attribution (Co-Authored-By, Generated with Claude Code, ...). Remove it - the user doesn't want Claude credited on commits.")
  }

  const message = commitMessage(git.args, words)
  if (message === null) continue

  const lines = message.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim())
  const [subject = '', ...body] = lines

  if (subject.length > MAX_SUBJECT) {
    deny(`Blocked: the commit subject is ${subject.length} chars, over the ${MAX_SUBJECT}-char limit. Shorten it.`)
  }
  if (body.length > MAX_BODY_LINES) {
    deny(`Blocked: the commit description is ${body.length} lines, over the ${MAX_BODY_LINES}-line limit. A description that long usually means more than one change - split it into separate commits, or cut the description to ${MAX_BODY_LINES} short lines.`)
  }
  const wide = body.find((l) => l.length > MAX_BODY_LINE)
  if (wide) {
    deny(`Blocked: a description line is ${wide.length} chars - wrap it at ${MAX_BODY_LINE} (still ${MAX_BODY_LINES} lines max).`)
  }
}
