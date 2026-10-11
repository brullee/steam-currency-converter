// Shared helpers for the PreToolUse hooks. Not a real shell parser - just enough to tell
// which program a Bash tool call runs and with which arguments, including the shapes
// Claude actually writes: chained commands, `bash -c "..."`, `$(...)`, and heredocs.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

export function readHookInput() {
  return JSON.parse(readFileSync(0, 'utf8'))
}

export function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }))
  process.exit(0)
}

// Heredocs are pulled out before tokenizing, since their bodies can hold any quote or
// separator character. `$(cat <<'EOF' ... EOF)` becomes __HEREDOC_n__ and a bare
// `<<'EOF' ... EOF` feeding stdin becomes __STDIN_n__; `bodies[n]` holds the text.
export function extractHeredocs(command) {
  const bodies = []
  const store = (body) => bodies.push(body) - 1
  let out = command.replace(
    /\$\(\s*cat\s+<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1[ \t]*\n([\s\S]*?)\n[ \t]*\2[ \t]*\n?\s*\)/g,
    (_m, _q, _delim, body) => `__HEREDOC_${store(body)}__`,
  )
  out = out.replace(
    /<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1([^\n]*)\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g,
    (_m, _q, _delim, rest, body) => ` __STDIN_${store(body)}__ ${rest}`,
  )
  return { command: out, bodies }
}

// Splits on ; & | ( ) ` and newlines outside quotes into simple commands, each a list of
// words with quotes removed.
function splitCommands(command) {
  const commands = []
  let words = []
  let word = ''
  let inWord = false
  const endWord = () => { if (inWord) words.push(word); word = ''; inWord = false }
  const endCommand = () => { endWord(); if (words.length) commands.push(words); words = [] }

  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (c === '$' && command[i + 1] === "'") {
      const end = command.indexOf("'", i + 2)
      const raw = command.slice(i + 2, end === -1 ? command.length : end)
      word += raw.replace(/\\(.)/g, (_m, e) => ({ n: '\n', t: '\t' })[e] ?? e)
      inWord = true
      i = end === -1 ? command.length : end
    } else if (c === "'") {
      const end = command.indexOf("'", i + 1)
      word += command.slice(i + 1, end === -1 ? command.length : end)
      inWord = true
      i = end === -1 ? command.length : end
    } else if (c === '"') {
      inWord = true
      for (i++; i < command.length && command[i] !== '"'; i++) {
        if (command[i] === '\\' && '"\\$`'.includes(command[i + 1])) i++
        word += command[i]
      }
    } else if (c === '\\') {
      if (command[i + 1] !== '\n') { word += command[i + 1] ?? ''; inWord = true }
      i++
    } else if (';&|()`\n'.includes(c)) {
      endCommand()
    } else if (c === ' ' || c === '\t') {
      endWord()
    } else {
      word += c
      inWord = true
    }
  }
  endCommand()
  return commands
}

const SHELLS = new Set(['bash', 'sh', 'zsh', 'fish', 'dash'])

// Every simple command, including ones nested where a shell would really run them:
// `bash -c "git push"`, `eval "..."`, and `$(...)`/backticks inside a quoted word. Other
// quoted text (a grep pattern, a commit message) is never treated as a command.
export function allCommands(command, depth = 0) {
  const result = []
  for (const words of splitCommands(command)) {
    result.push(words)
    if (depth >= 3) continue
    const p = program(words)
    words.forEach((w, i) => {
      const runsAsCommand =
        /`|\$\(/.test(w) ||
        (p && SHELLS.has(p.name) && words[i - 1] === '-c') ||
        (p?.name === 'eval' && i > 0)
      if (runsAsCommand) result.push(...allCommands(w, depth + 1))
    })
  }
  return result
}

const PREFIXES = new Set(['sudo', 'env', 'command', 'exec', 'time', 'nohup', 'builtin'])

// The program a simple command runs, skipping VAR=value assignments and wrappers like sudo.
export function program(words) {
  let i = 0
  while (i < words.length && (/^[A-Za-z_]\w*=/.test(words[i]) || PREFIXES.has(words[i]) || (i > 0 && PREFIXES.has(words[i - 1]) && words[i].startsWith('-')))) i++
  return i < words.length ? { name: basename(words[i]), args: words.slice(i + 1) } : null
}

const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix'])

// For a git command, its subcommand (push, commit, ...) after any global options like -C.
export function gitSubcommand(words) {
  const p = program(words)
  if (!p || p.name !== 'git') return null
  let i = 0
  while (i < p.args.length && p.args[i].startsWith('-')) i += GIT_OPTIONS_WITH_VALUE.has(p.args[i]) ? 2 : 1
  return i < p.args.length ? { sub: p.args[i], args: p.args.slice(i + 1) } : null
}
