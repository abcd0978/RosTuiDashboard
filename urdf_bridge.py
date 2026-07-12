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
                verts = load_stl(path, scale) if path else []
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
    import rclpy
    from std_msgs.msg import String
    rclpy.init()
    node = rclpy.create_node('rdash_urdf_bridge')
    state = {"m": []}

    def cb(msg):
        state["m"] = urdf_to_markers(msg.data)
        emit(state["m"])
    node.create_subscription(String, '/robot_description', cb, 1)
    import threading

    def repeat():
        import time
        while True:
            time.sleep(2.0)
            if state["m"]:
                emit(state["m"])
    threading.Thread(target=repeat, daemon=True).start()
    rclpy.spin(node)


if __name__ == '__main__':
    main()
