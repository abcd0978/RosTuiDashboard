#!/usr/bin/env python3
"""stdin 으로 들어오는 /tf(+/tf_static) echo(YAML) 를 읽어 프레임 트리를 텍스트로 출력.
RDash 가  `ros2 topic echo /tf` + `/tf_static` 를 이 스크립트에 파이프해 TF 계층을 보여준다.
transforms[].header.frame_id → child_frame_id 를 부모→자식 엣지로 모아 루트부터 들여쓰기."""
import sys
import collections

try:
    import yaml
except Exception:
    print("(PyYAML 필요)")
    sys.exit(0)

edges = []
block = []


def flush():
    text = "\n".join(block)
    if not text.strip():
        return
    try:
        doc = yaml.safe_load(text)
    except Exception:
        return
    trs = doc.get("transforms") if isinstance(doc, dict) else None
    if not trs:
        return
    for x in trs:
        try:
            p = str(x["header"]["frame_id"]).lstrip("/")
            c = str(x["child_frame_id"]).lstrip("/")
            if p and c:
                edges.append((p, c))
        except Exception:
            pass


for line in sys.stdin:
    line = line.rstrip("\n")
    if line.strip() == "---":
        flush()
        block = []
    else:
        block.append(line)
flush()

children = collections.defaultdict(list)
frames, has_parent, seen = set(), set(), set()
for p, c in edges:
    if (p, c) in seen:
        continue
    seen.add((p, c))
    children[p].append(c)
    frames.add(p)
    frames.add(c)
    has_parent.add(c)

roots = sorted(f for f in frames if f not in has_parent) or sorted(frames)[:1]
out = []


def walk(f, depth, visited):
    if f in visited:
        out.append("  " * depth + "└ " + f + "  (cycle)")
        return
    out.append("  " * depth + ("└ " if depth else "") + f)
    for c in sorted(set(children.get(f, []))):
        walk(c, depth + 1, visited | {f})


for r in roots:
    walk(r, 0, set())

print("\n".join(out) if out else "(no /tf frames — /tf 발행 없음?)")
