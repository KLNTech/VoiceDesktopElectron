import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'

import { z } from 'zod'

import { AgentModel } from '../../../shared/agent-model'
import { failed, succeeded, type Outcome, type TurnFailure } from '../../domain/model/turn'
import type { AgentReply } from '../../domain/model/agent-reply'
import type { AgentRequest, AgentRunner } from '../../domain/ports/AgentRunner'
import type { MarkdownNotesFolder, TouchedPaths } from '../notes/MarkdownNotesFolder'
import { couldNotFinish, readSpawnFailure } from '../process/spawn-failure'

const run = promisify(execFile)

/**
 * The CLI's own reply envelope, parsed rather than cast (`docs/PLAN.md` §5.3).
 *
 * Only the five fields this app consumes are declared; the envelope carries about twenty more.
 * Declaring the ones we use means a field that stops arriving fails loudly here, at the seam,
 * instead of surfacing as `undefined` three layers up in the interface.
 */
const ResultEvent = z.object({
  type: z.literal('result'),
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string(),
  session_id: z.string(),
  total_cost_usd: z.number().nullable().optional(),
  /**
   * Keyed by the model that ACTUALLY ran — observed: `claude-haiku-4-5-20251001`. This is what
   * makes the cheap tier auditable from the reply rather than trusted from the configuration,
   * which is the second half of S7's acceptance criterion.
   */
  modelUsage: z.record(z.string(), z.unknown()).optional(),
})

/** One `tool_use` block. The file paths in these are how the notes panel learns what happened. */
const ToolUse = z.object({
  type: z.literal('tool_use'),
  name: z.string(),
  input: z.object({ file_path: z.string().optional() }).loose(),
})

const AssistantEvent = z.object({
  type: z.literal('assistant'),
  message: z.object({ content: z.array(z.unknown()) }).loose(),
})

/** Tools that change a file on disk, as opposed to opening one. Drives `edited` vs `read`. */
const WRITING_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'NotebookEdit'])

/** The notes conventions, told to the agent rather than hoped for. */
const SYSTEM_PROMPT =
  'You keep the user\'s notes in the current directory: one Markdown file per subject, ' +
  'kebab-case file names ending in .md. Read the folder before answering questions about it. ' +
  'Answer in one short paragraph, with no preamble and no markdown headings.'

/**
 * The agent, as a spawned `claude -p` (`docs/PLAN.md` §5).
 *
 * The CLI already carries the agent loop, the file-editing tools, permission gating and session
 * state, so this adapter ships a harness rather than rebuilding a chat client. What it owns is
 * everything that makes another program safe to depend on: an argv array with no shell, a
 * bounded run that is killed when it overruns, a parsed reply, explicit session continuity, and
 * five distinguishable failures instead of "it didn't work".
 */
export class ClaudeCliAgentRunner implements AgentRunner {
  /**
   * One session id per app session, generated here and carried across turns (§5.4). It is a
   * field rather than a parameter because continuity is this adapter's promise: the caller
   * asks a question and should not have to know that two questions are two processes.
   */
  private sessionId: string | null = null

  constructor(
    private readonly binPath: string | null,
    private readonly model: AgentModel,
    private readonly notes: MarkdownNotesFolder,
    private readonly notesDir: string,
    private readonly isSignedIn: () => boolean,
    private readonly timeoutMs = 90_000,
  ) {}

  async run(request: AgentRequest, signal: AbortSignal): Promise<Outcome<AgentReply>> {
    // Both setup failures are settled BEFORE anything is spawned, because both have an exact
    // fix and neither is the agent's fault. Reporting either as an agent failure sends the user
    // to debug a program that is working correctly (§5.6).
    if (this.binPath === null) {
      return failed({
        kind: 'setup',
        what: 'agent-cli',
        hint: '`claude` was not found. Install it from https://claude.com/claude-code, or set VOICEDESK_AGENT_BIN to its absolute path.',
      })
    }
    if (!this.isSignedIn()) {
      return failed({
        kind: 'setup',
        what: 'agent-auth',
        hint: 'Claude Code is not signed in on this machine. Run `claude` in a terminal and log in once — VoiceDesk never handles the credential itself.',
      })
    }

    // The caller's session id wins when it has one, so a renderer that survived a reload can
    // hand back the thread it was on.
    const resuming = request.sessionId ?? this.sessionId
    const first = await this.spawn(request.text, resuming, signal)

    // A session the CLI has forgotten is a NORMAL outcome, not a crash: sessions expire, and
    // the app may well outlive one. Retry once as a fresh session rather than failing a turn
    // the user can have — the cost is an agent that re-reads `notes/`, which is where the
    // answer lives anyway (§5.4).
    if (first.k === 'failed' && resuming !== null && isForgottenSession(first.failure)) {
      this.sessionId = null
      return this.spawn(request.text, null, signal)
    }
    return first
  }

  private async spawn(
    text: string,
    resume: string | null,
    signal: AbortSignal,
  ): Promise<Outcome<AgentReply>> {
    if (this.binPath === null) throw new Error('unreachable: checked by run()')

    // Continuity is carried, not hoped for: a new session is NAMED on the way out, so a crash
    // between the spawn and the reply still leaves a thread this app knows how to resume.
    const session: SessionChoice =
      resume === null ? { k: 'new', id: randomUUID() } : { k: 'resume', id: resume }
    const args = agentArgs({ model: this.model, notesDir: this.notesDir, session })

    try {
      const pending = run(this.binPath, args, {
        cwd: this.notesDir,
        timeout: this.timeoutMs,
        maxBuffer: 8 << 20,
        signal,
      })

      /*
       * The prompt goes on STDIN, and that is a decision with two reasons.
       *
       * The first is that it cannot be passed safely as a positional argument here. `--add-dir`
       * and `--allowedTools` are VARIADIC: they consume every following bare word, so a prompt
       * sitting after either of them is swallowed as one more directory. Verified against
       * 2.1.263 — the CLI answers "Input must be provided either through stdin or as a prompt
       * argument", having eaten the prompt it is asking for. Ordering the argv around that is a
       * rule someone has to keep remembering; stdin removes the class.
       *
       * The second is that a process argument is world-readable. Everything the user dictates
       * would otherwise sit in `ps` output for every account on the machine, which is a strange
       * thing for an app whose entire input is someone talking.
       */
      pending.child.stdin?.end(text)
      const { stdout } = await pending

      return this.readReply(stdout)
    } catch (error) {
      return failed(this.classify(error))
    }
  }

  /** Walks the streamed events once, collecting what the panel needs and the reply itself. */
  private async readReply(stdout: string): Promise<Outcome<AgentReply>> {
    const read: string[] = []
    const edited: string[] = []
    let result: z.infer<typeof ResultEvent> | null = null

    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue

      let event: unknown
      try {
        event = JSON.parse(trimmed)
      } catch {
        // A partial or non-JSON line is not a reason to fail the turn: the envelope this app
        // needs is one specific event, and its absence is caught below with a message that
        // says so.
        continue
      }

      const assistant = AssistantEvent.safeParse(event)
      if (assistant.success) {
        collectToolPaths(assistant.data.message.content, read, edited)
        continue
      }
      const parsed = ResultEvent.safeParse(event)
      if (parsed.success) result = parsed.data
    }

    if (result === null) {
      return failed({
        kind: 'agent-failed',
        stderr: 'The agent produced no result event. This is the CLI\'s own output format changing, not a failed turn.',
      })
    }
    if (result.is_error) {
      return failed({ kind: 'agent-failed', stderr: lastLineOf(result.result) })
    }

    // Carried for the next turn, so "add milk" and "what's on my list?" are one conversation.
    this.sessionId = result.session_id

    return succeeded({
      text: result.result.trim(),
      notes: await this.notes.statusAfterTurn({ read, edited } satisfies TouchedPaths),
      // The model that RAN, named by the CLI. Falls back to the tier that was asked for, which
      // is the only honest answer when the envelope stops reporting one.
      model: Object.keys(result.modelUsage ?? {})[0] ?? this.model,
      sessionId: result.session_id,
      costUsd: result.total_cost_usd ?? null,
    })
  }

  private classify(error: unknown): TurnFailure {
    // The fields, and the three traps in them, are documented once in `spawn-failure.ts`.
    const failure = readSpawnFailure(error)

    if (failure.errno === 'ENOENT' || failure.errno === 'EACCES') {
      return {
        kind: 'setup',
        what: 'agent-cli',
        hint: `${this.binPath ?? 'claude'} could not be run. Reinstall Claude Code, or point VOICEDESK_AGENT_BIN at the binary.`,
      }
    }
    if (couldNotFinish(failure)) {
      return { kind: 'timeout', afterMs: this.timeoutMs }
    }
    return { kind: 'agent-failed', stderr: failure.detail }
  }
}

/** Which session this spawn belongs to: a new one it names, or one it is picking back up. */
export type SessionChoice = { k: 'new'; id: string } | { k: 'resume'; id: string }

/**
 * The argv for one spawn, as a pure function — every flag of `docs/PLAN.md` §5.2 and nothing
 * else. Separated from the spawn so the flag set can be ASSERTED rather than described: the
 * permission boundary this app is built around is these arguments, and a test that has to
 * launch the agent to check them is a test nobody runs.
 *
 * The prompt is deliberately absent. It travels on stdin — see the note in `spawn`.
 */
export function agentArgs(options: {
  model: AgentModel
  notesDir: string
  session: SessionChoice
}): string[] {
  return [
    '-p',
    // `stream-json` rather than `json` because only the streamed events carry the agent's tool
    // calls, and the tool calls are how the notes panel tells a file the agent REWROTE from one
    // it only opened. `--verbose` is not optional here: the CLI refuses the combination without
    // it, at runtime, with an error that says so.
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    options.model,
    // Exactly the capability the feature needs. `Bash` and every other command-running tool are
    // deliberately absent: "the agent might need it" trades the whole permission boundary for a
    // maybe.
    '--allowedTools',
    'Read',
    'Write',
    'Edit',
    'Glob',
    'Grep',
    // Belt to the allowlist's braces — removes the command-running tools and web fetch outright.
    '--restricted',
    // Not `bypassPermissions`, which would drop the boundary this app is built around.
    '--permission-mode',
    'acceptEdits',
    // No MCP servers inherited from whoever's machine this is. Behaviour that depends on
    // someone's local config is not behaviour that can be tested.
    '--strict-mcp-config',
    '--append-system-prompt',
    SYSTEM_PROMPT,
    // States the writable area explicitly rather than relying on `cwd` alone.
    '--add-dir',
    options.notesDir,
    ...(options.session.k === 'new'
      ? ['--session-id', options.session.id]
      : ['--resume', options.session.id]),
  ]
}

/** Pulls `file_path` off every tool call, sorted into the two things the panel distinguishes. */
function collectToolPaths(content: readonly unknown[], read: string[], edited: string[]): void {
  for (const block of content) {
    const tool = ToolUse.safeParse(block)
    if (!tool.success) continue
    const path = tool.data.input.file_path
    if (path === undefined) continue
    ;(WRITING_TOOLS.has(tool.data.name) ? edited : read).push(path)
  }
}

/**
 * Whether a failure is the CLI saying it does not have that session any more.
 *
 * Matched on the message because the CLI reports it as an ordinary non-zero exit and gives no
 * code to branch on. That makes this the one string-matched decision in the adapter, so it is
 * built to be wrong safely: a miss costs one retry that was not needed, never a wrong answer,
 * and the retry it triggers is the same work the first attempt was already doing.
 */
function isForgottenSession(failure: TurnFailure): boolean {
  if (failure.kind !== 'agent-failed') return false
  const text = failure.stderr.toLowerCase()
  return text.includes('session') && (text.includes('not found') || text.includes('no conversation'))
}

/** The last line is the one that says what went wrong; the rest is the program's banner. */
function lastLineOf(text: string): string {
  const lines = text.trim().split('\n')
  return (lines[lines.length - 1] ?? '').trim().slice(0, 500)
}
