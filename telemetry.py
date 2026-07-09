#!/usr/bin/env python3
"""ROS1 그래프 전체를 나열해 1초마다 JSON 한 줄 스트림.
토픽(발행+구독 전체)+Hz, 서비스, 파라미터, 노드를 하나의 item 리스트로 emit.
프런트(Ink)가 이걸로 트리를 만들고, 선택 시 rostopic echo / rosparam get /
rosservice info / rosnode info 를 직접 호출한다. master 없으면 {"nomaster":true}."""
import json
import sys
import time
import threading

import rosgraph


def emit(o):
    sys.stdout.write(json.dumps(o) + "\n")
    sys.stdout.flush()


while not rosgraph.is_master_online():
    emit({"nomaster": True})
    time.sleep(1.0)

import rospy
from rospy import AnyMsg

rospy.init_node("ros_tui", anonymous=True, disable_signals=True)
master = rosgraph.Master("/ros_tui")

_lock = threading.Lock()
counts = {}   # topic -> 수신 수(윈도우)
subs = {}     # topic -> Subscriber


def make_cb(name):
    def cb(_msg):
        with _lock:
            counts[name] = counts.get(name, 0) + 1
    return cb


t0 = time.time()
while not rospy.is_shutdown():
    try:
        pubs, subs_state, srvs = master.getSystemState()   # [[t,[nodes]],...] x3
    except Exception:
        pubs, subs_state, srvs = [], [], []
    try:
        ttypes = dict(master.getTopicTypes())
    except Exception:
        ttypes = {}

    pub_t = {t for t, _ in pubs}
    sub_t = {t for t, _ in subs_state}
    all_t = pub_t | sub_t
    services = sorted({s for s, _ in srvs})
    nodes = set()
    for _, ns in pubs:
        nodes.update(ns)
    for _, ns in subs_state:
        nodes.update(ns)
    for _, ns in srvs:
        nodes.update(ns)
    nodes = sorted(nodes)
    try:
        params = sorted(master.getParamNames())
    except Exception:
        params = []

    # 발행 중인 토픽만 Hz 측정(구독전용은 데이터가 없어 hz=0)
    for t in pub_t:
        if t not in subs:
            counts[t] = 0
            try:
                subs[t] = rospy.Subscriber(t, AnyMsg, make_cb(t))
            except Exception:
                pass

    time.sleep(1.0)
    if not rosgraph.is_master_online():
        emit({"nomaster": True})
        break
    now = time.time()
    dt = (now - t0) if now > t0 else 1.0
    t0 = now
    with _lock:
        rates = {t: round(counts.get(t, 0) / dt, 1) for t in pub_t}
        for t in list(counts):
            counts[t] = 0

    # 통합 item 리스트 — p 는 카테고리 접두 경로(트리용), name 은 실제 ROS 이름
    items = []
    for t in sorted(all_t):
        items.append({"p": "topics" + t, "kind": "topic", "name": t,
                      "ty": ttypes.get(t, "?"), "hz": rates.get(t, 0.0),
                      "sub": t not in pub_t})   # 구독전용 표시
    for s in services:
        items.append({"p": "services" + s, "kind": "service", "name": s})
    for p in params:
        items.append({"p": "params" + p, "kind": "param", "name": p})
    for nd in nodes:
        items.append({"p": "nodes" + nd, "kind": "node", "name": nd})
    emit({"items": items})
