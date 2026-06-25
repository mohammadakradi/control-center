import { Avatar } from "@/components/AgentAvatar";

/** Overlapping avatars of the agents that have run tasks in a project.
 *  `ringClass` should match the surrounding background so the stack reads cleanly. */
export function AgentContributors({
  namespaces,
  size = 28,
  ringClass = "ring-neutral-900",
}: {
  namespaces: string[];
  size?: number;
  ringClass?: string;
}) {
  if (namespaces.length === 0)
    return <span className="text-xs text-neutral-600">no runs yet</span>;

  return (
    <div className="flex items-center -space-x-2">
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
