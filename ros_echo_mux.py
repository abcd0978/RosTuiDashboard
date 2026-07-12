#!/usr/bin/env python3
"""단일 rclpy 노드 echo 멀티플렉서 — 웹서버가 토픽마다 `ros2 topic echo` 프로세스를 띄우는 대신
이 프로세스 1개만 띄운다(프로세스 폭증 해결). stdin 으로 구독 명령, stdout 으로 메시지.
  stdin  : '+/topic\\n' 구독 · '-/topic\\n' 해제
  stdout : JSON 한 줄 {"t":"/topic","b":"<yaml block>"}
사용: python3 ros_echo_mux.py [ver]   (RclNodeBackend 가 이 명령을 만든다)"""
import sys
import os
import json
import threading
import queue

os.environ.setdefault("RCUTILS_LOGGING_SEVERITY", "FATAL")

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy, DurabilityPolicy
from rosidl_runtime_py.utilities import get_message
from rosidl_runtime_py import message_to_yaml


def main():
    rclpy.init()
    node = Node("rdash_echo_mux")
    qos = QoSProfile(reliability=ReliabilityPolicy.BEST_EFFORT, history=HistoryPolicy.KEEP_LAST,
                     depth=5, durability=DurabilityPolicy.VOLATILE)
    subs = {}
    cmds = queue.Queue()

    def emit(topic, msg):
        try:
            sys.stdout.write(json.dumps({"t": topic, "b": message_to_yaml(msg)}) + "\n")
            sys.stdout.flush()
        except Exception:
            pass

    def type_of(topic):
        for n, ts in node.get_topic_names_and_types():
            if n == topic and ts:
                return ts[0]
        return None

    def add(topic):
        if topic in subs:
            return
        ty = type_of(topic)
        if not ty:
            subs[topic] = None
            return
        try:
            cb = (lambda t: (lambda m: emit(t, m)))(topic)
            subs[topic] = node.create_subscription(get_message(ty), topic, cb, qos)
        except Exception:
            subs[topic] = None

    def rm(topic):
        s = subs.pop(topic, None)
        if s is not None:
            try:
                node.destroy_subscription(s)
            except Exception:
                pass

    def reader():
        for line in sys.stdin:
            line = line.strip()
            if line and line[0] in "+-":
                cmds.put((line[0], line[1:]))
    threading.Thread(target=reader, daemon=True).start()

    # 구독 생성/파기는 spin 하는 메인 스레드에서 처리(rclpy 스레드 안전성).
    while rclpy.ok():
        while not cmds.empty():
            op, topic = cmds.get()
            (add if op == "+" else rm)(topic)
        rclpy.spin_once(node, timeout_sec=0.1)


if __name__ == "__main__":
    main()
