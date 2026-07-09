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


# 선택적 Hz 측정 — RDash 가 RDASH_CTRL 파일에 측정 정책을 쓰면 그것만 구독(관측자 부하↓).
CTRL = os.environ.get("RDASH_CTRL")


def measure_policy():
    """None=전체 측정, set()=측정 안 함, set([...])=지정 토픽만."""
    if not CTRL:
        return None
    try:
        with open(CTRL) as f:
            m = json.load(f).get("measure", "all")
    except Exception:
        return None
    if m == "all":
        return None
    if m == "none":
        return set()
    return set(m) if isinstance(m, list) else None


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


def drop(name):
    """구독 해제 + 카운터 정리(사라진/측정중단 토픽)."""
    s = subs.pop(name, None)
    if s is not None:
        try:
            node.destroy_subscription(s)
        except Exception:
            pass
    counts.pop(name, None)


while rclpy.ok():
    tnt = node.get_topic_names_and_types()          # [(name, [types]), ...]
    types = {n: (ts[0] if ts else "?") for n, ts in tnt}
    pol = measure_policy()                          # 측정 정책(선택적 Hz)
    for n, ty in types.items():
        allowed = (pol is None) or (n in pol)
        if allowed and n not in subs:
            counts[n] = 0
            try:
                # raw=True → 역직렬화 없이 직렬화 바이트만 콜백에 전달(카운트 전용).
                # PointCloud2/Image 같은 대용량·고빈도 토픽에서 CPU 를 크게 절약(관측자 부하↓).
                try:
                    subs[n] = node.create_subscription(get_message(ty), n, make_cb(n), QOS, raw=True)
                except TypeError:                   # 구버전 rclpy: raw 인자 미지원 → 일반 구독 폴백
                    subs[n] = node.create_subscription(get_message(ty), n, make_cb(n), QOS)
            except Exception:
                subs[n] = None                      # 타입 로드 실패 → hz 만 0
        elif not allowed and n in subs:
            drop(n)                                 # 정책에서 빠진 토픽 구독 해제
    for n in [n for n in subs if n not in types]:   # 사라진 토픽 정리(누수 방지)
        drop(n)
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
