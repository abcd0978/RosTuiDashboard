#!/usr/bin/env python3
"""TF 프레임 브리지 — /tf(+/tf_static)를 구독해 각 프레임의 루트 기준 변환을 JSON 한 줄씩 stdout 으로.
웹 3D 씬이 프레임을 좌표축으로 렌더. 사용: python3 tf_dump.py
출력: {"frames":[{"id":name,"parent":parent,"p":[x,y,z],"q":[x,y,z,w]}]}  (p/q 는 루트 기준 누적 변환)"""
import sys
import json
import math


def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return [aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz]


def qrot(q, v):
    x, y, z, w = q; vx, vy, vz = v
    tx = 2 * (y * vz - z * vy); ty = 2 * (z * vx - x * vz); tz = 2 * (x * vy - y * vx)
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)]


def main():
    import rclpy
    from rclpy.node import Node
    from tf2_msgs.msg import TFMessage
    rclpy.init()
    node = Node('rdash_tf_dump')
    edges = {}   # child → (parent, p, q)

    def on(msg):
        for t in msg.transforms:
            tr, ro = t.transform.translation, t.transform.rotation
            edges[t.child_frame_id.lstrip('/')] = (t.header.frame_id.lstrip('/'),
                                                   [tr.x, tr.y, tr.z], [ro.x, ro.y, ro.z, ro.w])
    node.create_subscription(TFMessage, '/tf', on, 50)
    node.create_subscription(TFMessage, '/tf_static', on, 50)

    def world(frame, seen):
        # 루트까지 부모 체인을 곱해 누적 변환 반환.
        if frame in seen or frame not in edges:
            return [0, 0, 0], [0, 0, 0, 1]
        parent, p, q = edges[frame]
        pp, pq = world(parent, seen | {frame})
        wp = [pp[i] + qrot(pq, p)[i] for i in range(3)]
        return wp, qmul(pq, q)

    import time
    while rclpy.ok():
        rclpy.spin_once(node, timeout_sec=0.1)
        frames = []
        for f in list(edges.keys()):
            wp, wq = world(f, set())
            frames.append({"id": f, "parent": edges[f][0], "p": wp, "q": wq})
        if frames:
            sys.stdout.write(json.dumps({"frames": frames}) + "\n"); sys.stdout.flush()
        time.sleep(0.2)


if __name__ == '__main__':
    main()
