/**
 * Is a turn's last message the task's FINAL REPORT, or did the agent just stop mid-work?
 *
 * In streaming-input mode the SDK emits a `result` message at the end of every turn and
 * then waits for more input, so the runner — not the SDK — decides whether the task is
 * finished (see ./session-manager). The workflow contract says a finished run ends with a
 * report gate or a trailing `[[DONE]]`; when neither arrived we used to take the turn's
 * last assistant text, staple `[[DONE]]` onto it and call the task done. That mislabels
 * ordinary narration as the report: real transcripts have shown "I'll follow the fe:task
 * workflow — first, investigation. Let me read the workflow rules…" rendered as the
 * report card with the task marked Done, before any work existed.
 *
 * So classify the text before trusting it — and make **sealing** the side that needs
 * evidence. The first version asked "is there a positive signal of continuation?" and
 * sealed whenever there wasn't; that let a short tool-call preamble through whenever it
 * named no dispatched work and used no announcing verb. Reproduced on `task_2ad6afb5`,
 * sealed `done` on *"Smoking gun found. Let me confirm the reconciler's status coverage."*
 * while the session kept running. Now a turn seals only when its closing text actually
 * **looks like a report** (`looksLikeReport`): structured, or long enough to carry one,
 * or saying that work was completed. Anything else is "the agent stopped mid-work".
 *
 * The cost of that inversion is a possible extra nudge turn for a terse, marker-less
 * summary — deliberately preferred over sealing a task that isn't finished, since the
 * agent's contract is to end on a report gate or `[[DONE]]` anyway.
 */

export type PauseReason =
  /** Ended the turn narrating that it will resume once dispatched work reports back. */
  | "waiting"
  /** Ended the turn announcing its next action instead of reporting a result. */
  | "narration"
  /** Ended the turn with no prose at all (e.g. right after a tool call). */
  | "no-text"
  /** Ended on prose that carries no report — a step along the way, not a result. */
  | "unfinished";

export type TurnEnd = { kind: "final" } | { kind: "paused"; reason: PauseReason };

/** Workflow markers are stripped before classifying — a trailing `[[DONE]]` is handled
 *  by the caller, and an inline one must not hide the sentence it sits next to. */
const MARKERS = /\[\[(?:DONE|GATE:[A-Z]+)\]\]/g;

/** The agent sometimes ends a turn *mid-workflow* — e.g. right after dispatching its
 *  review/audit subagents — narrating that it will pick back up once they report. That
 *  is NOT completion: finalizing there synthesizes a bogus "done" and drops the real
 *  report/gate the agent produces next. Matched anywhere in the text, because "I'll
 *  report back once the reviewers finish" is a pause no matter where it sits. */
export const WAITING_RE =
  /\b(standing by|will resume|report(?:ing)? back|wait(?:ing|s)? (?:for|on)|i'?ll (?:resume|continue|wait)|continue once|once (?:they|it|the)\b[^.]*\b(?:report|finish|complete|return|back)|running in the background|in the background\b[^.]*\b(?:wait|report|verdict|result|finish)|before the (?:report|proposal) gate|dispatch(?:ed|ing)\b[^.]*\b(?:review|audit|sub-?agents?|sub-?tasks?))/i;

/**
 * Dispatched work the agent says is *still outstanding* — the shape `WAITING_RE` misses because
 * the sentence never mentions waiting at all: "both review agents are still running", "the
 * audit hasn't returned yet". Measured against a real transcript that ended exactly that way
 * and was accepted as a finished report.
 *
 * It is deliberately much narrower than `WAITING_RE`: a named piece of dispatched work
 * (reviewer / auditor / subagent) **and** an explicit statement that it hasn't finished. That
 * tightness is the point — `WAITING_RE` matches "I'll wait for your approval to push" and
 * "Waiting for your go-ahead", both of which are *finished* reports, so it can never be
 * applied anywhere the answer seals a task. This one is checked against both sets: six
 * in-flight phrasings match, and six finished-report phrasings (including "I ran the reviewer
 * and the security auditor. Both came back clean" and "Tests are still running in CI, but the
 * change is complete") do not.
 */
export const IN_FLIGHT_RE =
  /\b(?:review(?:er)?s?|audit(?:or)?s?|sub-?agents?|sub-?tasks?)\b[^.\n]{0,60}?(?:\bstill\b[^.\n]{0,24}?\b(?:running|going|in flight|in progress|working)|\b(?:haven'?t|hasn'?t|have not|has not|not yet)\b[^.\n]{0,32}?\b(?:report|return|finish|complet|come back|landed))/i;

/** Throat-clearing that can precede the real clause: "Okay, now let me…". */
const PREAMBLE =
  "(?:(?:ok(?:ay)?|right|alright|good|great|perfect|hmm+|now|next|first|then|so|and|also|finally)\\b[\\s,.!:;—–-]*)*";

/** First-person announcements of the NEXT action — the tell for narration that was
 *  meant to be followed by tool calls, not read as a conclusion. */
const INTENT_RE = new RegExp(
  `^${PREAMBLE}(?:let(?:'|’)?s\\b|let me\\b(?!\\s+know\\b)|i(?:'|’)?ll\\b|i will\\b|i(?:'|’)?m (?:going to|about to|gonna)\\b|i am (?:going to|about to)\\b|going to\\b|time to\\b)`,
  "i",
);

/**
 * The subset of `INTENT_RE` that announces a *next action* so plainly it is narration
 * wherever it sits — including at the end of a long, structured message, which is the hole
 * `looksStructured` opened: an analysis with bullet points that signs off "Let me confirm
 * the reconciler's status coverage." used to seal the task.
 *
 * A bare "I'll …" is deliberately NOT here: "I'll wait for your approval to push" and
 * "I'll hold off on committing" are how finished reports end. Only the shapes that name a
 * step the agent is about to take — "let me / let's / next I'll / now I'll / I'm going to /
 * time to". "Let me know" is excluded in both patterns: it closes reports, not preambles.
 */
const NEXT_ACTION_RE = new RegExp(
  `^${PREAMBLE}(?:let(?:'|’)?s\\b|let me\\b(?!\\s+know\\b)|i(?:'|’)?m (?:going to|about to|gonna)\\b|i am (?:going to|about to)\\b|going to\\b|time to\\b|(?:next|now|then|first)\\b[\\s,]*i(?:'|’)?(?:ll|m)\\b|i(?:'|’)?ll now\\b)`,
  "i",
);

/** Bare gerund lead-ins ("Checking the transcripts", "Running the tests") — only a
 *  pause signal on a short, single-line message; a report can open the same way. */
const GERUND_RE =
  /^(?:check|read|search|grep|run|look|inspect|verify|confirm|investigat|review|scan|dig|open|list|start|continu|build|fix|updat|add|writ|port|wir)\w*ing\b/i;
const GERUND_MAX_LEN = 200;

/** A structured, substantial message is a report even if its closing sentence sounds
 *  like an intention ("…I'll wait for your approval"). Guards against demoting a real
 *  report; kept narrow (headings/lists *and* real length) so a long narrated plan
 *  doesn't sneak through. */
const STRUCTURE_MIN_LEN = 240;
const LIST_LINE = /^\s*(?:[-*+•]\s|\d+[.)]\s|#{1,6}\s)/;

function looksStructured(text: string): boolean {
  if (text.length < STRUCTURE_MIN_LEN) return false;
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.filter((l) => LIST_LINE.test(l)).length >= 2;
}

/** Says that work was *carried out*, which is what a report says and a preamble doesn't.
 *  Investigation verbs ("found", "confirmed", "checked") are deliberately absent: they are
 *  exactly what mid-work narration says. */
const REPORTED_WORK_RE =
  /\b(?:complete[ds]?|finished|fixed|resolved|implemented|refactored|migrated|committed|merged|shipped|reverted|verified|tests? (?:pass|passed|passing)|passes|passing|all green|no (?:outstanding|remaining|blocking|further) \w+|nothing (?:else )?(?:was )?(?:touched|changed)|is now|are now|now (?:does|has|shows|renders|returns))\b/i;

/** Enough text around a completion phrase to be a report rather than a status blip —
 *  "The tests pass now." is something an agent says mid-work. */
const REPORT_MIN_LEN = 60;
/** Prose long enough that it cannot be a tool-call preamble, even with no completion
 *  vocabulary in it at all. The safety valve for reports written in an unusual register. */
const PROSE_MIN_LEN = 500;

/**
 * Positive evidence that this text IS the turn's report. Checked only after the pause
 * signals have had their say, so a message that announces a next step can't buy its way
 * back with a stray "fixed".
 */
export function looksLikeReport(body: string): boolean {
  if (looksStructured(body)) return true;
  if (body.length >= REPORT_MIN_LEN && REPORTED_WORK_RE.test(body)) return true;
  return body.length >= PROSE_MIN_LEN;
}

/** The last sentence of the last non-empty line, with list/quote markers removed. */
export function lastSentence(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const line = (lines[lines.length - 1] ?? "").replace(
    /^(?:[-*+•>]\s+|\d+[.)]\s+|#{1,6}\s+)/,
    "",
  );
  const sentences = line
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences[sentences.length - 1] ?? line;
}

/**
 * Classify the text of the LAST main-thread assistant message of a turn that ended
 * without a report gate, a `[[GATE:…]]` marker or a trailing `[[DONE]]`.
 */
export function classifyTurnEnd(text: string): TurnEnd {
  const body = text.replace(MARKERS, "").trim();
  if (!body) return { kind: "paused", reason: "no-text" };
  // "I'll pick this back up once the reviewers report" — a pause wherever it appears,
  // and worth its own nudge because the dispatched work is already finished by now.
  if (WAITING_RE.test(body) || IN_FLIGHT_RE.test(body))
    return { kind: "paused", reason: "waiting" };
  // A message that ends by asking the user something is a deliberate stop, not a pause —
  // nudging it would answer the question on the user's behalf. (Rule 8: agents may ask
  // when genuinely blocked; the user replies into the live task.)
  if (/[?？]\s*$/.test(body)) return { kind: "final" };
  // Nobody ends a final report on a colon; it introduces the tool call that follows.
  if (/[:：]\s*$/.test(body)) return { kind: "paused", reason: "narration" };
  const tail = lastSentence(body);
  // "Let me confirm the reconciler's status coverage." — narration however long or
  // well-formatted the message around it is (see NEXT_ACTION_RE).
  if (NEXT_ACTION_RE.test(tail)) return { kind: "paused", reason: "narration" };
  const structured = looksStructured(body);
  if (INTENT_RE.test(tail) && !structured)
    return { kind: "paused", reason: "narration" };
  if (
    GERUND_RE.test(tail) &&
    body.length <= GERUND_MAX_LEN &&
    !body.includes("\n")
  )
    return { kind: "paused", reason: "narration" };
  // Nothing above says "pause" — but that is not enough to seal a task. The turn ends the
  // run only if the text positively reads as a report; otherwise the agent stopped
  // mid-work on prose that happened to name no next step ("Smoking gun found.").
  if (looksLikeReport(body)) return { kind: "final" };
  return { kind: "paused", reason: "unfinished" };
}
