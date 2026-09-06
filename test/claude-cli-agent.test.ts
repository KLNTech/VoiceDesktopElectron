import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { AgentModel } from '../shared/agent-model'
import { agentArgs, ClaudeCliAgentRunner } from '../src/infrastructure/agent/ClaudeCliAgentRunner'
import { MarkdownNotesFolder } from '../src/infrastructure/notes/MarkdownNotesFolder'
import { hasClaudeLogin } from '../src/infrastructure/agent/keychain'
import { resolveBinary } from '../src/infrastructure/process/resolveBinary'

const agentBin = resolveBinary('claude', process.env['VOICEDESK_AGENT_BIN'])
const signedIn = hasClaudeLogin()
// Skips rather than fails without the CLI or a login: both are the reviewer's install steps,
// not defects. What must never happen is passing while doing nothing, so the two cheap tests
// below run unconditionally and assert the setup failures instead.
const ready = agentBin !== null && signedIn

const work = mkdtempSync(join(tmpdir(), 'voicedesk-agent-'))
afterAll(() => rmSync(work, { recursive: true, force: true }))

function runner(dir: string, bin = agentBin): ClaudeCliAgentRunner {
  return new ClaudeCliAgentRunner(
    bin,
    AgentModel.Haiku,
    new MarkdownNotesFolder(dir),
    dir,
    () => true,
    120_000,
  )
}

describe('the agent adapter, without needing the CLI', () => {
  it('reports a missing binary as SETUP, naming what to do about it', async () => {
    const result = await runner(work, null).run(
      { text: 'add milk', sessionId: null },
      AbortSignal.timeout(5_000),
    )

    expect(result).toMatchObject({ k: 'failed', failure: { kind: 'setup', what: 'agent-cli' } })
    if (result.k === 'failed' && result.failure.kind === 'setup') {
      expect(result.failure.hint).toMatch(/VOICEDESK_AGENT_BIN|claude\.com/)
    }
  })

  it('reports "never signed in" as its OWN setup failure, not as the agent failing', async () => {
    // The distinction §5.6 exists for: the binary is present and runs, the turn still fails,
    // and nothing about this app is broken. Filed as `agent-failed` it would send the user to
    // debug the agent; filed as `agent-auth` it tells them to run `claude` once.
    const neverSignedIn = new ClaudeCliAgentRunner(
      agentBin ?? '/usr/bin/true',
      AgentModel.Haiku,
      new MarkdownNotesFolder(work),
      work,
      () => false,
      5_000,
    )

    const result = await neverSignedIn.run(
      { text: 'add milk', sessionId: null },
      AbortSignal.timeout(5_000),
    )

    expect(result).toMatchObject({ k: 'failed', failure: { kind: 'setup', what: 'agent-auth' } })
    if (result.k === 'failed' && result.failure.kind === 'setup') {
      expect(result.failure.hint).toMatch(/terminal/i)
    }
  })

})
/**
 * The permission boundary this app is built around IS this argument list, so it is asserted
 * rather than described. Every row of `docs/PLAN.md` §5.2 appears below; a flag silently
 * dropped in a refactor is the kind of change that widens the blast radius and breaks nothing
 * a normal test would notice.
 */
describe('the argv the agent is spawned with', () => {
  const args = agentArgs({
    model: AgentModel.Haiku,
    notesDir: '/tmp/notes',
    session: { k: 'new', id: 'a-session-id' },
  })

  it('passes exactly the five tools the feature needs, and no command-running tool', () => {
    const tools = args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--restricted'))

    expect(tools).toEqual(['Read', 'Write', 'Edit', 'Glob', 'Grep'])
    // The one that must never appear. "The agent might need it" trades the entire boundary.
    expect(args).not.toContain('Bash')
  })

  it('keeps every flag that narrows what the agent may do', () => {
    expect(args).toContain('--restricted')
    expect(args).toContain('--strict-mcp-config')
    expect(args.slice(args.indexOf('--permission-mode'))).toContain('acceptEdits')
    // The one that would drop the boundary entirely.
    expect(args).not.toContain('bypassPermissions')
  })

  it('names the writable area and the tier explicitly', () => {
    expect(args[args.indexOf('--add-dir') + 1]).toBe('/tmp/notes')
    expect(args[args.indexOf('--model') + 1]).toBe('haiku')
    // An alias, never a dated snapshot: it cannot resolve above the tier it names.
    expect(args[args.indexOf('--model') + 1]).not.toMatch(/\d{8}|-4-|-5-/)
  })

  it('asks for the streamed format, with the flag the CLI refuses to run without', () => {
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json')
    // Not decoration: `--output-format=stream-json` without it is a runtime error, and the
    // notes panel has no tool calls to read from without the streamed events.
    expect(args).toContain('--verbose')
  })

  it('names a new session, and resumes a known one', () => {
    expect(args[args.indexOf('--session-id') + 1]).toBe('a-session-id')
    expect(args).not.toContain('--resume')

    const resumed = agentArgs({
      model: AgentModel.Haiku,
      notesDir: '/tmp/notes',
      session: { k: 'resume', id: 'earlier-session' },
    })
    expect(resumed[resumed.indexOf('--resume') + 1]).toBe('earlier-session')
    expect(resumed).not.toContain('--session-id')
  })

  it('never carries the spoken text, which is why the prompt goes on stdin', () => {
    // A dictated sentence in argv is visible in `ps` to every account on the machine — an odd
    // property for an app whose entire input is someone talking. It is also unpassable here:
    // `--add-dir` and `--allowedTools` are variadic and swallow a trailing positional.
    expect(args.some((arg) => arg.includes('milk'))).toBe(false)
    expect(args.filter((arg) => arg === '-p')).toHaveLength(1)
  })
})

describe.skipIf(!ready)('the agent adapter, against the real CLI', () => {
  it('creates a note from speech, then answers from it on the next turn', async () => {
    // S7's acceptance criterion, verbatim from the brief: *"add milk to my shopping list"*
    // creates or edits a note, and *"what's on my list?"* answers from it — through the CLI,
    // not the raw API, with the blast radius bounded to this directory.
    const dir = mkdtempSync(join(work, 'notes-'))
    const agent = runner(dir)

    const first = await agent.run(
      { text: 'add milk to my shopping list', sessionId: null },
      AbortSignal.timeout(120_000),
    )

    expect(first.k).toBe('ok')
    if (first.k !== 'ok') return

    // The agent wrote a real file, and the panel can say which one it changed.
    const written = readdirSync(dir).filter((name) => name.endsWith('.md'))
    expect(written.length).toBeGreaterThan(0)
    expect(first.value.notes.some((note) => note.status === 'edited')).toBe(true)
    expect(readFileSync(join(dir, written[0] ?? ''), 'utf8').toLowerCase()).toContain('milk')

    // The cheap tier, proved by the REPLY rather than assumed from the flag — the second half
    // of the acceptance criterion, and the reason `model` is on `AgentReply` at all.
    expect(first.value.model).toContain('haiku')
    expect(first.value.sessionId).not.toBeNull()

    // Two spawns, one conversation (§5.4). This is the half that fails if `--resume` is wrong.
    const second = await agent.run(
      { text: "what's on my list?", sessionId: first.value.sessionId },
      AbortSignal.timeout(120_000),
    )

    expect(second.k).toBe('ok')
    if (second.k !== 'ok') return
    expect(second.value.text.toLowerCase()).toContain('milk')
    // It had to open the file to answer, and the panel distinguishes that from rewriting it.
    expect(second.value.notes.some((note) => note.status !== 'unchanged')).toBe(true)
  }, 260_000)

  it('kills the run when it overruns, and says so as a timeout', async () => {
    const dir = mkdtempSync(join(work, 'slow-'))
    const impatient = new ClaudeCliAgentRunner(
      agentBin,
      AgentModel.Haiku,
      new MarkdownNotesFolder(dir),
      dir,
      () => true,
      1_500, // far under any real turn: the point is that the deadline is enforced, not tuned
    )

    const result = await impatient.run(
      { text: 'write a detailed essay about the history of shipping containers', sessionId: null },
      AbortSignal.timeout(60_000),
    )

    expect(result).toMatchObject({ k: 'failed', failure: { kind: 'timeout' } })
  }, 90_000)
})

describe('the notes folder', () => {
  it('lists markdown at rest, all unchanged, sorted, ignoring everything else', async () => {
    const dir = mkdtempSync(join(work, 'listing-'))
    writeFileSync(join(dir, 'shopping.md'), '- milk\n')
    writeFileSync(join(dir, 'ideas.md'), '- a boat\n')
    writeFileSync(join(dir, 'notes.txt'), 'not a note\n')

    const files = await new MarkdownNotesFolder(dir).list()

    expect(files.map((file) => file.name)).toEqual(['ideas.md', 'shopping.md'])
    expect(files.every((file) => file.status === 'unchanged')).toBe(true)
  })

  it('creates the folder rather than reporting an empty one that does not exist', async () => {
    const dir = join(work, 'not-yet', 'nested')

    expect(await new MarkdownNotesFolder(dir).list()).toEqual([])
    expect(readdirSync(dir)).toEqual([])
  })

  it('ranks edited over read, and leaves the untouched majority alone', async () => {
    const dir = mkdtempSync(join(work, 'status-'))
    writeFileSync(join(dir, 'shopping.md'), '- milk\n')
    writeFileSync(join(dir, 'ideas.md'), '- a boat\n')
    writeFileSync(join(dir, 'untouched.md'), 'nothing happened here\n')

    const files = await new MarkdownNotesFolder(dir).statusAfterTurn({
      // Opened and then rewritten: one event to report, and the change is the half that matters.
      read: [join(dir, 'shopping.md'), join(dir, 'ideas.md')],
      edited: [join(dir, 'shopping.md')],
    })

    expect(files).toEqual([
      { name: 'ideas.md', status: 'read' },
      { name: 'shopping.md', status: 'edited' },
      { name: 'untouched.md', status: 'unchanged' },
    ])
  })

  it('refuses to render a path from outside the notes folder', async () => {
    // `--add-dir` and `--restricted` are the CLI's promise, not this app's knowledge. A panel
    // that draws any path it is handed turns a confinement bug into a display of someone's home
    // directory, so paths that climb out are dropped rather than shown.
    const dir = mkdtempSync(join(work, 'escape-'))
    writeFileSync(join(dir, 'shopping.md'), '- milk\n')

    const files = await new MarkdownNotesFolder(dir).statusAfterTurn({
      read: ['/etc/passwd', join(dir, '..', 'elsewhere.md'), 'nested/deeper.md'],
      edited: [],
    })

    expect(files).toEqual([{ name: 'shopping.md', status: 'unchanged' }])
  })
})
