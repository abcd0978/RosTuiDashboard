// ROS 그래프 item 리스트 → 네임스페이스 트리 구성/평탄화(펼침 반영).
export function buildTree(items) {
  const root = { name: '', path: '', children: new Map(), item: null };
  for (const it of items) {
    const parts = it.p.split('/').filter(Boolean);   // p = "topics/mavros/state" 등(카테고리 접두)
    let node = root, path = '';
    parts.forEach((part, i) => {
      path += '/' + part;
      if (!node.children.has(part)) node.children.set(part, { name: part, path, children: new Map(), item: null });
      node = node.children.get(part);
      if (i === parts.length - 1) node.item = it;
    });
  }
  return root;
}

export function flattenTree(node, expanded, depth, out, force) {
  const kids = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const c of kids) {
    const hasKids = c.children.size > 0;
    out.push({ node: c, depth, hasKids });
    if (hasKids && (force || expanded.has(c.path))) flattenTree(c, expanded, depth + 1, out, force);   // 검색 중엔 전부 펼침
  }
  return out;
}
