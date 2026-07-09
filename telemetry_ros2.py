#!/usr/bin/env python3
"""ROS2 그래프 나열 + Hz 측정 → 1초마다 JSON(ROS1 telemetry.py 와 같은 items 포맷).
rclpy 제네릭 구독으로 모든 토픽 Hz 측정(best-effort QoS 로 대부분 수신).
파라미터는 ROS2 에선 노드별이라 목록엔 없음(노드 info 에서 확인)."""
import json
import os
import sys
import time

os.environ.setdefault("RCUTILS_LOGGING_SEVERITY", "FATAL")   # QoS 경고 등 억제

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy, DurabilityPolicy
from rosidl_runtime_py.utilities import get_message


def emit(o):
    sys.stdout.write(json.dumps(o) + "\n")
    sys.stdout.flush()


rclpy.init()
node = Node("ros_tui")
# best-effort 구독 → reliable/best-effort 발행자 양쪽에서 라이브 메시지 수신
QOS = QoSProfile(reliability=ReliabilityPolicy.BEST_EFFORT,
                 history=HistoryPolicy.KEEP_LAST, depth=5,
                 durability=DurabilityPolicy.VOLATILE)

counts = {}
subs = {}


def make_cb(name):
    def cb(_msg):
        counts[name] = counts.get(name, 0) + 1
    return cb


while rclpy.ok():
    tnt = node.get_topic_names_and_types()          # [(name, [types]), ...]
    types = {n: (ts[0] if ts else "?") for n, ts in tnt}
    for n, ty in types.items():
        if n not in subs:
            counts[n] = 0
            try:
                subs[n] = node.create_subscription(get_message(ty), n, make_cb(n), QOS)
            except Exception:
                subs[n] = None                      # 타입 로드 실패 → hz 만 0
    services = sorted({s for s, _ in node.get_service_names_and_types()})
    nodes = sorted({(ns.rstrip("/") + "/" + nm) for nm, ns in node.get_node_names_and_namespaces()})

    # 1초 수집 윈도우 (spin_once 로 콜백 처리)
    for n in list(counts):
        counts[n] = 0
    t0 = time.time()
    while time.time() - t0 < 1.0:
        rclpy.spin_once(node, timeout_sec=0.05)
    dt = max(1e-3, time.time() - t0)
    rates = {n: round(counts.get(n, 0) / dt, 1) for n in types}

    items = []
    for n in sorted(types):
        items.append({"p": "topics" + n, "kind": "topic", "name": n,
                      "ty": types[n], "hz": rates.get(n, 0.0)})
    for s in services:
        items.append({"p": "services" + s, "kind": "service", "name": s})
    for nd in nodes:
        items.append({"p": "nodes" + nd, "kind": "node", "name": nd})
    emit({"items": items} if items else {"nomaster": True})
