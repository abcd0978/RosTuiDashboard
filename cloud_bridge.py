#!/usr/bin/env python3
"""포인트클라우드 브리지 — PointCloud2 를 구독해 점당 (x,y,z,c) float32 로 다운샘플, JSON 한 줄씩 stdout.
c 채널 = intensity 값 또는 packed-rgb(r*65536+g*256+b, <2^24 라 float32 정확) 또는 0. 색상 모드는 클라이언트가 선택.
웹 백엔드(web/server.js WS)가 바이너리로 받아 그대로 브라우저에 WS 로 전달(base64 없음 = 최속 경로).
출력(프레임당 바이너리 프레임): [uint32 LE len][uint32 LE mode][float32 stride4 x,y,z,c ...]  (len = 4 + 부동소수 바이트)
  mode: 0=xyz · 1=intensity · 2=rgb
사용: python3 cloud_bridge.py <topic>
LOD/전송 튜닝(env):
  RDASH_CLOUD_VOXEL  복셀 그리드 다운샘플 크기(m). 0=끔. 예: 0.05 → 5cm 격자당 1점.
  RDASH_CLOUD_MAXN   프레임당 최대 점(기본 30000). 복셀 후에도 넘치면 균등 솎기."""
import sys
import os
import struct

MODEN = {'xyz': 0, 'intensity': 1, 'rgb': 2}

MAXN = int(os.environ.get('RDASH_CLOUD_MAXN', '30000') or 30000)
VOXEL = float(os.environ.get('RDASH_CLOUD_VOXEL', '0') or 0)


def voxel_downsample(pts, voxel, np):
    """복셀 격자당 대표점 1개 — 공간적으로 균일하게 점 수를 줄인다(구조 보존, 전송량 감소)."""
    keys = np.floor(pts / voxel).astype(np.int64)
    keys -= keys.min(axis=0)
    dims = keys.max(axis=0) + 1
    lin = keys[:, 0] * (dims[1] * dims[2]) + keys[:, 1] * dims[2] + keys[:, 2]
    _, idx = np.unique(lin, return_index=True)
    return pts[idx]


def main():
    topic = sys.argv[1] if len(sys.argv) > 1 else '/cloud_registered'
    import numpy as np
    from ros_compat import Bridge
    b = Bridge('rdash_cloud_bridge')
    from sensor_msgs.msg import PointCloud2

    def cb(msg):
        try:
            off = {f.name: f.offset for f in msg.fields}
            if not all(k in off for k in ('x', 'y', 'z')):
                return
            n = msg.width * msg.height
            ps = msg.point_step
            raw = np.frombuffer(bytes(msg.data), dtype=np.uint8)
            if n * ps != raw.size:
                return
            arr = raw.reshape((n, ps))

            def colf(o):
                return arr[:, o:o + 4].copy().view(np.float32).reshape(-1)

            # c 채널: rgb 우선, 없으면 intensity, 없으면 0.
            mode = 'xyz'
            if 'rgb' in off or 'rgba' in off:
                o = off.get('rgb', off.get('rgba'))
                u = arr[:, o:o + 4].copy().view(np.uint32).reshape(-1)
                r = (u >> 16) & 255
                g = (u >> 8) & 255
                b = u & 255
                c = (r.astype(np.float64) * 65536 + g * 256 + b).astype(np.float32)
                mode = 'rgb'
            elif 'intensity' in off:
                c = colf(off['intensity'])
                mode = 'intensity'
            else:
                c = np.zeros(n, dtype=np.float32)

            pts = np.stack([colf(off['x']), colf(off['y']), colf(off['z']), c], axis=1)
            fin = np.isfinite(pts[:, :3]).all(axis=1)
            pts = pts[fin]
            if VOXEL > 0 and pts.shape[0] > 0:
                pts = voxel_downsample(pts, VOXEL, np)
            if pts.shape[0] > MAXN:
                idx = np.linspace(0, pts.shape[0] - 1, MAXN).astype(int)
                pts = pts[idx]
            payload = struct.pack('<I', MODEN.get(mode, 0)) + pts.astype('<f4').tobytes()
            sys.stdout.buffer.write(struct.pack('<I', len(payload)) + payload)
            sys.stdout.buffer.flush()
        except Exception:
            pass

    b.subscribe(PointCloud2, topic, cb)
    b.spin()


if __name__ == '__main__':
    main()
