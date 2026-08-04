export type OrganizationNode = {
  id: number;
  parentId: number | null;
};

export function collectDescendantIds(
  nodes: OrganizationNode[],
  rootId: number,
): number[] {
  const children = new Map<number, number[]>();
  for (const node of nodes) {
    if (node.parentId == null) continue;
    const current = children.get(node.parentId) ?? [];
    current.push(node.id);
    children.set(node.parentId, current);
  }

  const result: number[] = [];
  const queue = [...(children.get(rootId) ?? [])];
  const visited = new Set<number>([rootId]);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    result.push(id);
    queue.push(...(children.get(id) ?? []));
  }
  return result;
}
