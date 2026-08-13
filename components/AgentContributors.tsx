import { Avatar } from "@/components/AgentAvatar";

/** Overlapping avatars of the agents that have run tasks in a project.
 *  `ringClass` should match the surrounding background so the stack reads cleanly. */
export function AgentContributors({
  namespaces,
  size = 28,
  ringClass = "ring-surface-2",
}: {
  namespaces: string[];
  size?: number;
  ringClass?: string;
}) {
  if (namespaces.length === 0)
    return <span className="text-xs text-fg-faint">no runs yet</span>;

  const label = `${namespaces.length} contributing agent${
    namespaces.length === 1 ? "" : "s"
  }: ${namespaces.map((n) => `/${n}`).join(", ")}`;

  return (
    <div className="flex items-center -space-x-2" role="img" aria-label={label}>
      {namespaces.map((ns) => (
        <div
          key={ns}
          title={`/${ns}`}
          className={`rounded-full ring-2 ${ringClass}`}
        >
          <Avatar namespace={ns} size={size} />
        </div>
      ))}
    </div>
  );
}
