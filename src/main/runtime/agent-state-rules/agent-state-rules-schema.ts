import { z } from 'zod'
import type { RuntimeTerminalWaitBlockedReason } from '../../../shared/runtime-types'
import type { TuiAgent } from '../../../shared/tui-agent'
import { isTuiAgent } from '../../../shared/tui-agent-config'
import { findUnsafePatternReason } from './agent-state-rule-pattern-safety'

/**
 * One file per agent (`<agent>.json` beside this schema). Every object is strict, so a misspelled
 * field rejects the file instead of silently dropping a condition. Every rule and anchor is
 * `when` (a region and what it must show) plus `answer`; adding a region, predicate or
 * answer bumps `engineVersion`.
 */
const AGENT_STATE_RULES_ENGINE_VERSION = 1

const MAX_PATTERN_LENGTH = 200
const MAX_RULES = 32
const MAX_ROWS = 12
const MAX_TERMS = 8

const Literal = z.string().min(1).max(MAX_PATTERN_LENGTH)

// Why: these are matched against the lowercased text tail, so an uppercase letter never matches.
const TailLiteral = Literal.refine(
  (text) => text === text.toLowerCase(),
  'must be lowercase: the text tail is lowercased'
)

const SafeRegex = Literal.superRefine((pattern, ctx) => {
  const reason = findUnsafePatternReason(pattern)
  if (reason) {
    ctx.addIssue({ code: 'custom', message: `pattern ${reason}` })
  }
})

/** A test on one row or one text segment: a single term, or every `all`, some `any`, no `none`. */
function textTestSchema(containsLiteral: typeof Literal) {
  const term = z.union([
    z.object({ regex: SafeRegex, ignoreCase: z.boolean().optional() }).strict(),
    z.object({ contains: containsLiteral }).strict()
  ])
  const terms = z.array(term).min(1).max(MAX_TERMS)
  return z.union([
    term,
    z
      .object({ all: terms.optional(), any: terms.optional(), none: terms.optional() })
      .strict()
      .refine((test) => Boolean(test.all ?? test.any ?? test.none), 'needs all, any or none')
  ])
}

const TextTestSchema = textTestSchema(Literal)
const TailTextTestSchema = textTestSchema(TailLiteral)

const RowSchema = z.union([TextTestSchema, z.object({ optional: TextTestSchema }).strict()])

/** The evidence behind a rule, since JSON carries no comments; it ships beside the pattern it explains. */
const Why = z.string().min(1).max(600)

/**
 * The trusted screen grid. `rows` are consecutive trimmed rows, top-down; the block ends at the
 * bottom-most row, among the last `endsWithinBottom`, that passes the final test, and a row above
 * the screen reads as empty. With no `rows`, the condition holds whenever the screen is readable.
 */
const ScreenConditionSchema = z
  .object({
    region: z.literal('screen'),
    rows: z.array(RowSchema).min(1).max(MAX_ROWS).optional(),
    endsWithinBottom: z.number().int().min(1).max(MAX_ROWS).optional(),
    noneAbove: TextTestSchema.optional()
  })
  .strict()
  .refine(
    (screen) => screen.rows || (!screen.endsWithinBottom && !screen.noneAbove),
    'endsWithinBottom and noneAbove need rows'
  )
  .refine(
    (screen) => !('optional' in (screen.rows?.at(-1) ?? {})),
    'the last row cannot be optional'
  )

// Why one region: title, text and status regions arrive with the agents that need them.
const RuleConditionSchema = z.discriminatedUnion('region', [ScreenConditionSchema])

const RuleAnswerSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('idle'),
      /** Strong settles a wait at once; weak only on the poll, once nothing stronger spoke. */
      strength: z.enum(['strong', 'weak']),
      /** Believed only after the output clock has been quiet (agents paint this mid-turn too). */
      requiresQuiet: z.boolean()
    })
    .strict(),
  // Why hold: the agent's own evidence was readable and said "not ready", which must also shut
  // the weak lanes (a name-only title or quiet process cannot see what the screen refused).
  z.object({ state: z.literal('hold') }).strict()
])

/** One entry in the agent's priority list: highest `priority` first, ties in file order. */
const AgentStateRuleSchema = z
  .object({
    id: Literal,
    why: Why,
    priority: z.number().int().min(0).max(1000),
    when: RuleConditionSchema,
    answer: RuleAnswerSchema
  })
  .strict()

const NAMED_TEXT_ANCHORS = ['antigravity-text-composer'] as const

const AGENT_BLOCKED_REASONS = [
  'agent-update-prompt',
  'agent-trust-workspace',
  'agent-cwd-prompt',
  'agent-hooks-review-prompt',
  'agent-interactive-prompt',
  'agent-approval-prompt'
] as const satisfies readonly RuntimeTerminalWaitBlockedReason[]

/**
 * A position in the lowercased text tail. Anchors are not part of the agent's priority list: they
 * read every pane whatever agent it runs (a tail can show another agent's dialog, and an adopted
 * pane has no known agent), and the latest one in the text wins. A blocked anchor reads the
 * blocked layer's live window; an idle or working one is a live prompt, which cancels an earlier
 * blocker, and only an idle one settles a wait.
 */
const TextAnchorSchema = z
  .object({
    id: Literal,
    why: Why,
    when: z
      .object({
        /** Where the anchor starts: a literal's last occurrence, or a named engine scan. */
        find: z.union([
          z.object({ lastOf: TailLiteral }).strict(),
          z.object({ predicate: z.enum(NAMED_TEXT_ANCHORS) }).strict()
        ]),
        /** Reads only the last N lines of its input. */
        withinLastLines: z.number().int().min(1).max(64).optional(),
        /** The text from the anchor to the end must pass this. */
        after: TailTextTestSchema.optional(),
        /** Over the lines read, trailing blanks dropped: at least `atLeast` pass, the last one too
         *  when `includingLast`. */
        lines: z
          .object({
            atLeast: z.number().int().min(1).max(MAX_ROWS),
            includingLast: z.boolean(),
            test: TailTextTestSchema
          })
          .strict()
          .optional()
      })
      .strict(),
    answer: z.discriminatedUnion('state', [
      z.object({ state: z.literal('blocked'), reason: z.enum(AGENT_BLOCKED_REASONS) }).strict(),
      z.object({ state: z.literal('idle') }).strict(),
      z.object({ state: z.literal('working') }).strict()
    ])
  })
  .strict()
  .refine(
    (anchor) => anchor.answer.state !== 'blocked' || 'lastOf' in anchor.when.find,
    "a blocked anchor needs find.lastOf: the blocked layer's prefilter keys on it"
  )

/** Facts about the agent that are not detection rules. */
const ProfileSchema = z
  .object({
    /** Text whose presence in a pane's tail makes a tui-idle wait read its visible screen once. */
    screenProbeBanner: TailLiteral.optional()
  })
  .strict()

export const AgentStateRulesFileSchema = z
  .object({
    id: z.custom<TuiAgent>(isTuiAgent, 'not a known agent'),
    engineVersion: z.literal(AGENT_STATE_RULES_ENGINE_VERSION),
    profile: ProfileSchema.optional(),
    textAnchors: z.array(TextAnchorSchema).max(MAX_RULES),
    rules: z.array(AgentStateRuleSchema).max(MAX_RULES)
  })
  .strict()

export type TextTest = z.infer<typeof TextTestSchema>
export type ScreenCondition = z.infer<typeof ScreenConditionSchema>
export type AgentStateRuleAnswer = z.infer<typeof RuleAnswerSchema>
export type TextAnchor = z.infer<typeof TextAnchorSchema>
export type NamedTextAnchor = (typeof NAMED_TEXT_ANCHORS)[number]
export type AgentStateRulesFile = z.infer<typeof AgentStateRulesFileSchema>
