#!/usr/bin/env python3
"""URDF RobotModel 브리지 — robot_description(파일/토픽/파라미터)를 파싱해 링크 비주얼을 마커 JSON 으로.
프리미티브(box/cylinder/sphere)는 마커 타입(1/3/2), mesh(.stl)는 TRIANGLE_LIST(타입 11)로 삼각형 방출.
각 마커의 frame_id = 링크 이름 → 3D 씬이 TF 로 배치. 정적이라 2초마다 재방출(늦은 구독자 대응).
사용: python3 urdf_bridge.py [urdf_file | 'topic']    (인자 없으면 /robot_description 토픽 구독)"""
import sys
import os
import json
import math
import struct
import xml.etree.ElementTree as ET


def rpy_to_q(r, p, y):
    cr, sr = math.cos(r / 2), math.sin(r / 2)
    cp, sp = math.cos(p / 2), math.sin(p / 2)
    cy, sy = math.cos(y / 2), math.sin(y / 2)
    return [sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy,
            cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy]


def parse_origin(el):
    o = el.find('origin') if el is not None else None
    xyz = [0.0, 0.0, 0.0]
    rpy = [0.0, 0.0, 0.0]
    if o is not None:
        if o.get('xyz'):
            xyz = [float(v) for v in o.get('xyz').split()]
        if o.get('rpy'):
            rpy = [float(v) for v in o.get('rpy').split()]
    return xyz, rpy_to_q(*rpy)


def resolve_mesh(uri):
    if uri.startswith('package://'):
        pkg, _, rel = uri[len('package://'):].partition('/')
        try:
            from ament_index_python.packages import get_package_share_directory
            return os.path.join(get_package_share_directory(pkg), rel)
        except Exception:
            return None
    if uri.startswith('file://'):
        return uri[len('file://'):]
    return uri


def load_mesh(path, scale):
    """확장자별 메시 로더 — .stl / .obj / .dae(Collada) → 삼각형 정점 리스트(3의 배수)."""
    low = path.lower()
    if low.endswith('.obj'):
        return load_obj(path, scale)
    if low.endswith('.dae'):
        return load_dae(path, scale)
    return load_stl(path, scale)


def load_obj(path, scale):
    """Wavefront OBJ — v(정점) + f(면, 팬 삼각화). 텍스처/노멀 인덱스는 무시(v만)."""
    sx, sy, sz = scale
    vs, out = [], []
    try:
        with open(path, 'r', errors='ignore') as f:
            for line in f:
                p = line.split()
                if not p:
                    continue
                if p[0] == 'v' and len(p) >= 4:
                    vs.append([float(p[1]) * sx, float(p[2]) * sy, float(p[3]) * sz])
                elif p[0] == 'f' and len(p) >= 4:
                    idx = []
                    for tok in p[1:]:
                        i = int(tok.split('/')[0])
                        idx.append(i - 1 if i > 0 else len(vs) + i)
                    for k in range(1, len(idx) - 1):     # 팬 삼각화
                        for j in (0, k, k + 1):
                            if 0 <= idx[j] < len(vs):
                                out.append(vs[idx[j]])
    except Exception:
        return []
    return out


def load_dae(path, scale):
    """Collada DAE — 첫 geometry 의 positions(float_array) + triangles/polylist 인덱스로 삼각형화.
    up_axis(Z_UP/Y_UP) 와 unit(meter) 반영. 흔한 익스포트(정점 입력·삼각형) 대상 서브셋."""
    sx, sy, sz = scale
    try:
        tree = ET.parse(path)
    except Exception:
        return []
    root = tree.getroot()
    ns = {'c': root.tag[root.tag.find('{') + 1:root.tag.find('}')]} if '{' in root.tag else {}
    q = (lambda t: 'c:' + t) if ns else (lambda t: t)

    def find(el, t):
        return el.find(q(t), ns) if ns else el.find(t)

    def findall(el, t):
        return el.findall('.//' + q(t), ns) if ns else el.findall('.//' + t)

    unit = 1.0
    up = 'Y_UP'
    asset = find(root, 'asset')
    if asset is not None:
        u = find(asset, 'unit')
        if u is not None and u.get('meter'):
            unit = float(u.get('meter'))
        ua = find(asset, 'up_axis')
        if ua is not None and ua.text:
            up = ua.text.strip()

    def conv(x, y, z):
        # up_axis 를 ROS Z-up 으로. (Y_UP: (x,y,z)->(x,-z,y))
        if up == 'Y_UP':
            x, y, z = x, -z, y
        elif up == 'X_UP':
            x, y, z = -y, x, z
        return [x * unit * sx, y * unit * sy, z * unit * sz]

    out = []
    for geom in findall(root, 'geometry'):
        mesh = find(geom, 'mesh')
        if mesh is None:
            continue
        # positions source: <vertices><input semantic=POSITION source=#id> → <source id><float_array>
        srcs = {}
        for s in findall(mesh, 'source'):
            fa = find(s, 'float_array')
            if fa is not None and fa.text:
                srcs['#' + s.get('id')] = [float(v) for v in fa.text.split()]
        posid = None
        verts_el = find(mesh, 'vertices')
        if verts_el is not None:
            for inp in (verts_el.findall(q('input'), ns) if ns else verts_el.findall('input')):
                if inp.get('semantic') == 'POSITION':
                    posid = inp.get('source')
        vertsrc = '#' + (verts_el.get('id') if verts_el is not None else '')
        prims = findall(mesh, 'triangles') + findall(mesh, 'polylist') + findall(mesh, 'polygons')
        for prim in prims:
            inputs = prim.findall(q('input'), ns) if ns else prim.findall('input')
            stride = 0
            voff = 0
            for inp in inputs:
                off = int(inp.get('offset', '0'))
                stride = max(stride, off + 1)
                if inp.get('semantic') == 'VERTEX':
                    voff = off
            pel = find(prim, 'p')
            if pel is None or not pel.text:
                continue
            p = [int(x) for x in pel.text.split()]
            pos = srcs.get(posid) or srcs.get(vertsrc) or next(iter(srcs.values()), [])
            vcount = find(prim, 'vcount')
            faces = []
            if vcount is not None and vcount.text:      # polylist
                counts = [int(x) for x in vcount.text.split()]
                k = 0
                for cnt in counts:
                    face = [p[(k + j) * stride + voff] for j in range(cnt)]
                    k += cnt
                    faces.append(face)
            else:                                         # triangles
                for tri in range(0, len(p) // stride, 3):
                    faces.append([p[(tri + j) * stride + voff] for j in range(3)])
            for face in faces:
                for k in range(1, len(face) - 1):         # 팬 삼각화
                    for j in (0, k, k + 1):
                        vi = face[j]
                        if vi * 3 + 2 < len(pos):
                            out.append(conv(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]))
    return out


def load_stl(path, scale):
    """STL(바이너리/ASCII) → 삼각형 정점 리스트([[x,y,z]...], 3의 배수). 스케일 반영."""
    try:
        with open(path, 'rb') as f:
            data = f.read()
    except Exception:
        return []
    sx, sy, sz = scale
    verts = []
    if data[:5].lower() == b'solid' and b'facet' in data[:2000]:
        for line in data.decode('ascii', 'ignore').splitlines():
            line = line.strip()
            if line.startswith('vertex'):
                _, x, y, z = line.split()[:4]
                verts.append([float(x) * sx, float(y) * sy, float(z) * sz])
    else:
        n = struct.unpack('<I', data[80:84])[0]
        off = 84
        for _ in range(n):
            if off + 50 > len(data):
                break
            vals = struct.unpack('<12f', data[off + 12:off + 48])
            for k in range(3):
                verts.append([vals[k * 3] * sx, vals[k * 3 + 1] * sy, vals[k * 3 + 2] * sz])
            off += 50
    return verts


def urdf_to_markers(xml):
    try:
        root = ET.fromstring(xml)
    except Exception:
        return []
    markers = []
    mid = 0
    for link in root.findall('link'):
        name = link.get('name')
        for vis in link.findall('visual'):
            geom = vis.find('geometry')
            if geom is None:
                continue
            xyz, q = parse_origin(vis)
            mat = vis.find('material')
            col = [0.75, 0.78, 0.82, 1.0]
            if mat is not None and mat.find('color') is not None and mat.find('color').get('rgba'):
                col = [float(v) for v in mat.find('color').get('rgba').split()]
            mid += 1
            base = {"ns": "urdf", "id": mid, "action": 0, "frame_id": name,
                    "pose": {"p": xyz, "q": q}, "color": col, "points": [], "colors": [], "text": ""}
            box = geom.find('box')
            cyl = geom.find('cylinder')
            sph = geom.find('sphere')
            mesh = geom.find('mesh')
            if box is not None:
                s = [float(v) for v in box.get('size', '1 1 1').split()]
                markers.append({**base, "type": 1, "scale": s})
            elif cyl is not None:
                r = float(cyl.get('radius', '0.1'))
                length = float(cyl.get('length', '0.1'))
                markers.append({**base, "type": 3, "scale": [r * 2, r * 2, length]})
            elif sph is not None:
                r = float(sph.get('radius', '0.1'))
                markers.append({**base, "type": 2, "scale": [r * 2, r * 2, r * 2]})
            elif mesh is not None:
                path = resolve_mesh(mesh.get('filename', ''))
                scale = [float(v) for v in mesh.get('scale', '1 1 1').split()] if mesh.get('scale') else [1, 1, 1]
                verts = load_mesh(path, scale) if path else []
                if verts:
                    markers.append({**base, "type": 11, "scale": [1, 1, 1], "points": verts})
                else:
                    markers.append({**base, "type": 1, "scale": [0.1, 0.1, 0.1]})   # 폴백: 작은 박스
    return markers


def emit(markers):
    sys.stdout.write(json.dumps({"markers": markers}) + "\n")
    sys.stdout.flush()


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'topic'
    if src != 'topic' and os.path.isfile(src):
        with open(src) as f:
            markers = urdf_to_markers(f.read())
        import time
        while True:
            emit(markers)
            time.sleep(2.0)
        return
    # 토픽 /robot_description (std_msgs/String, latched) 구독.
    from std_msgs.msg import String
    from ros_compat import Bridge
    b = Bridge('rdash_urdf_bridge')
    state = {"m": []}

    def cb(msg):
        state["m"] = urdf_to_markers(msg.data)
        emit(state["m"])
    b.subscribe(String, '/robot_description', cb, best_effort=False, transient_local=True, depth=1)
    import threading

    def repeat():
        import time
        while True:
            time.sleep(2.0)
            if state["m"]:
                emit(state["m"])
    threading.Thread(target=repeat, daemon=True).start()
    b.spin()


if __name__ == '__main__':
    main()
