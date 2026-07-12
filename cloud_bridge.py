#!/usr/bin/env python3
"""포인트클라우드 브리지 — PointCloud2 를 구독해 xyz 를 float32 로 다운샘플, base64 한 줄씩 stdout 으로.
웹 3D 패널(web/server.js /cloudstream)이 SSE 로 받아 canvas 2D 투영으로 렌더한다.
사용: python3 cloud_bridge.py <topic>"""
import sys
import base64

MAXN = 30000   # 프레임당 최대 점(WebGL 이 넉넉히 소화)


def main():
    topic = sys.argv[1] if len(sys.argv) > 1 else '/cloud_registered'
    import rclpy
    import numpy as np
    rclpy.init()
    node = rclpy.create_node('rdash_cloud_bridge')
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

            def col(o):
                return arr[:, o:o + 4].copy().view(np.float32).reshape(-1)

            pts = np.stack([col(off['x']), col(off['y']), col(off['z'])], axis=1)
            pts = pts[np.isfinite(pts).all(axis=1)]
            if pts.shape[0] > MAXN:
                idx = np.linspace(0, pts.shape[0] - 1, MAXN).astype(int)
                pts = pts[idx]
            sys.stdout.write(base64.b64encode(pts.astype('<f4').tobytes()).decode() + '\n')
            sys.stdout.flush()
        except Exception:
            pass

    node.create_subscription(PointCloud2, topic, cb, 5)
    rclpy.spin(node)


if __name__ == '__main__':
    main()
