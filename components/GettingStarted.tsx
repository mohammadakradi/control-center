import Link from "next/link";
import type { ReactNode } from "react";
import { Check, FolderPlus, KeyRound, Rocket } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { canRunTasks, secretsConfigured } from "@/lib/secrets";
import { buttonClasses } from "@/components/ui/button";
import { card } from "@/components/ui-cards";

type Step = {
  title: string;
  /** One line explaining the step — and, between the three, the app's vocabulary. */
  explainer: string;
  done: boolean;
  icon: ReactNode;
  cta?: { href: string; label: string };
  /** Warn-toned while incomplete — for a step that blocks everything downstream. */
  blocking?: boolean;
};

/**
 * First-run checklist: token → project → first task. Renders `null` once all three are
 * satisfied, so it costs an established user nothing.
 *
 * On the dashboard this **replaces** `TokenNudge` — the token is step 1 here, and two
 * banners saying the same thing on one screen is the duplication this was meant to fix.
 * `TokenNudge` still stands alone on project detail and backlog, where a checklist would
 * be off-topic.
 *
 * Server component: it reads the vault directly, like `TokenNudge`, and never ships token
 * state to the client. Project/task counts come from the caller, which has already
 * queried them.
 */
export async function GettingStarted({
  hasProject,
  hasTask,
  firstProjectId,
}: {
  hasProject: boolean;
  hasTask: boolean;
  /** Where "Run your first task" points. Absent only when there's no project yet — in
   *  which case that step isn't the current one and shows no action anyway. */
  firstProjectId?: string;
}) {
  const user = await getCurrentUser();
  const hasToken = canRunTasks(user.id);
  const vaultReady = secretsConfigured();

  if (hasToken && hasProject && hasTask) return null;

  const steps: Step[] = [
    {
      title: "Add your Anthropic token",
      explainer: vaultReady
        ? "Agents run on your own Claude plan or API key, so nothing can be dispatched until one is saved."
        : "The server is missing SECRETS_MASTER_KEY, so token storage is disabled — see .env.example.",
      done: hasToken,
      icon: <KeyRound className="size-4" aria-hidden="true" />,
      cta: vaultReady ? { href: "/settings", label: "Open Settings" } : undefined,
      // Nothing runs without this one, so it carries the warning `TokenNudge` used to.
      blocking: true,
    },
    {
      title: "Add a project",
      explainer:
        "A project is a folder on this device. Register one by absolute path and agents can read and change the files inside it.",
      done: hasProject,
      icon: <FolderPlus className="size-4" aria-hidden="true" />,
      cta: { href: "/projects", label: "Add a project" },
    },
    {
      title: "Run your first task",
      explainer:
        "Open the project, pick an agent and a skill, and describe the work. You'll watch it run live.",
      done: hasTask,
      icon: <Rocket className="size-4" aria-hidden="true" />,
      cta: firstProjectId
        ? { href: `/projects/${firstProjectId}`, label: "Open project" }
        : undefined,
    },
  ];

  // Exactly one action at a time — the point of a checklist is that there's an obvious
  // next thing to do, not three competing buttons.
  const currentIndex = steps.findIndex((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;

  return (
    // The warn tone lives on the blocking *step*, not on this card: `card` already sets
    // `border-line`, so a conditional `border-warn-line` here would be two same-specificity
    // border-colour utilities racing in the emitted CSS. Tone the row we build ourselves.
    <section aria-labelledby="getting-started-heading" className={card}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2
          id="getting-started-heading"
          className="text-base font-semibold text-fg-strong"
        >
          Get started
        </h2>
        <p className="text-xs text-fg-faint">{doneCount} of {steps.length} done</p>
      </div>
      <p className="mb-4 max-w-2xl text-sm text-fg-subtle">
        An <strong className="font-medium text-fg-muted">agent</strong> is an installed
        Claude Code plugin, a <strong className="font-medium text-fg-muted">project</strong>{" "}
        is a folder on this device, and a{" "}
        <strong className="font-medium text-fg-muted">task</strong> is one agent command run
        against a project. Three steps to your first one:
      </p>

      <ol className="space-y-2">
        {steps.map((step, i) => {
          const current = i === currentIndex;
          // State is spoken, not just coloured — a checkmark and a tinted row are no use
          // to a screen reader, and the colour alone is no use to anyone who can't see it.
          const state = step.done ? "Done" : current ? "Next" : "To do";
          // A blocking step that isn't done is the one thing standing between this user
          // and a working app, so it gets the warn tone rather than the plain "current"
          // treatment — that's the urgency `TokenNudge` carried as a banner.
          const blocked = !step.done && step.blocking;
          return (
            <li
              key={step.title}
              className={`flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border px-3.5 py-3 ${
                blocked
                  ? "border-warn-line bg-warn-soft"
                  : current
                    ? "border-line-strong bg-surface-2"
                    : "border-line"
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-px grid size-7 shrink-0 place-items-center rounded-full border ${
                  step.done
                    ? "border-ok-line bg-ok-soft text-ok"
                    : blocked
                      ? "border-warn-line bg-warn-soft text-warn"
                      : current
                        ? "border-info-line bg-info-soft text-info"
                        : "border-muted-line bg-muted-soft text-muted"
                }`}
              >
                {step.done ? <Check className="size-4" /> : step.icon}
              </span>

              {/* `min-w-40`, not `min-w-0`: with `flex-1` and no floor the text column
                  collapses to a sliver beside the CTA instead of letting `flex-wrap` push
                  the CTA onto its own line — at 390px the explainer wrapped one word per
                  line. 160px is under the narrowest row (172px of text space at 320px), so
                  it forces the wrap without ever overflowing. */}
              <div className="min-w-40 flex-1">
                {/* On a warn-toned row the text is warn-toned too — `bg-{t}-soft` pairs
                    with `text-{t}` by contract, and it's the pairing `TokenNudge` used for
                    this exact message. */}
                <p
                  className={`text-sm font-medium ${
                    blocked
                      ? "text-warn"
                      : step.done
                        ? "text-fg-muted"
                        : "text-fg-strong"
                  }`}
                >
                  <span className="sr-only">{state}: </span>
                  {step.title}
                </p>
                <p
                  className={`mt-0.5 text-xs leading-relaxed ${
                    blocked ? "text-warn/80" : "text-fg-faint"
                  }`}
                >
                  {step.explainer}
                </p>
              </div>

              {current && step.cta && (
                <Link
                  href={step.cta.href}
                  className={buttonClasses("secondary", "sm", "mt-px")}
                >
                  {step.cta.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
