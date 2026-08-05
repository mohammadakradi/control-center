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
 * So classify the text before trusting it. The bias is deliberately conservative: only a
 * POSITIVE signal of continuation ("…and then I'll", a trailing colon, waiting on
 * subagents, no text at all) counts as a pause. Ambiguous prose is still treated as a
 * final report, which keeps commands that legitimately end with a plain summary and no
 * marker (e.g. `onboard`) working exactly as before.
 */

export type PauseReason =
  /** Ended the turn narrating that it will resume once dispatched work reports back. */
  | "waiting"
  /** Ended the turn announcing its next action instead of reporting a result. */
  | "narration"
  /** Ended the turn with no prose at all (e.g. right after a tool call). */
  | "no-text";

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

/** Throat-clearing that can precede the real clause: "Okay, now let me…". */
const PREAMBLE =
  "(?:(?:ok(?:ay)?|right|alright|good|great|perfect|hmm+|now|next|first|then|so|and|also|finally)\\b[\\s,.!:;—–-]*)*";

/** First-person announcements of the NEXT action — the tell for narration that was
 *  meant to be followed by tool calls, not read as a conclusion. */
const INTENT_RE = new RegExp(
  `^${PREAMBLE}(?:let(?:'|’)?s\\b|let me\\b|i(?:'|’)?ll\\b|i will\\b|i(?:'|’)?m (?:going to|about to|gonna)\\b|i am (?:going to|about to)\\b|going to\\b|time to\\b)`,
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
  if (WAITING_RE.test(body)) return { kind: "paused", reason: "waiting" };
  // A message that ends by asking the user something is a deliberate stop, not a pause —
  // nudging it would answer the question on the user's behalf. (Rule 8: agents may ask
  // when genuinely blocked; the user replies into the live task.)
  if (/[?？]\s*$/.test(body)) return { kind: "final" };
  // Nobody ends a final report on a colon; it introduces the tool call that follows.
  if (/[:：]\s*$/.test(body)) return { kind: "paused", reason: "narration" };
  const tail = lastSentence(body);
  if (INTENT_RE.test(tail) && !looksStructured(body))
    return { kind: "paused", reason: "narration" };
  if (
    GERUND_RE.test(tail) &&
    body.length <= GERUND_MAX_LEN &&
    !body.includes("\n")
  )
    return { kind: "paused", reason: "narration" };
  return { kind: "final" };
}
