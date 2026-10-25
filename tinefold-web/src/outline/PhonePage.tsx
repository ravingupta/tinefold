import type { Graph, TreeNode } from "@ravingupta/tinefold-engine";
import { Tag } from "../app/ui";
import { ProjectChips } from "../projects/ProjectChips";
import { useGraph } from "./GraphContext";
import { Comments, Progress } from "./Rail";

/**
 * Phones never get the tree: it needs a large screen to be read, let alone decided on.
 * What a phone can do is follow progress and leave comments for the next desktop session.
 */
export function PhonePage({ snapshot, tree }: { snapshot: Graph; tree: TreeNode }) {
  const { session } = useGraph();
  return (
    <div className="mx-auto max-w-[640px] px-4 pb-16 pt-4">
      <ProjectChips graphId={session.graphId} />
      <div className="mt-3 flex items-center gap-2 text-[13px] text-ink-2">
        <span>The problem</span>
        {snapshot.rootVersions.length > 1 && <Tag tone="cobalt">version {tree.version}</Tag>}
      </div>
      <h1 className="mt-1.5 text-[clamp(1.2rem,5vw,1.5rem)] font-bold leading-[1.2] tracking-[-0.012em]">{tree.title}</h1>
      <p className="mt-1 line-clamp-3 text-[14px] leading-relaxed text-ink-2">{tree.summary}</p>
      <p className="mt-4 rounded-md bg-paper px-3 py-2 text-[13px] text-ink-2">
        The tree is for a desktop or tablet screen. Here you can follow what is still open and leave comments; they wait for your next session.
      </p>
      <div className="mt-6 space-y-6 text-[14px]">
        <Progress snapshot={snapshot} jump={null} />
        <Comments snapshot={snapshot} />
      </div>
    </div>
  );
}
