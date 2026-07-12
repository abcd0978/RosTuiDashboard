#!/usr/bin/env python3
"""6-DOF 인터랙티브 마커 브리지 — visualization_msgs/InteractiveMarker 서버(<topic>/update, get service)를
구독해 각 마커의 pose·scale·비주얼 마커·6-DOF 핸들(이동축/회전축)을 JSON 한 줄씩 stdout 으로.
stdin 으로 피드백(JSON: {"name","pose":{p,q},"event"})을 받아 <topic>/feedback 에 InteractiveMarkerFeedback 발행
→ 브라우저 3D 씬에서 기즈모 드래그 → ROS 로 실시간 반영(RViz 인터랙티브 마커와 동일 왕복).

핸들 축 = 각 control.orientation 의 로컬 x축을 회전한 방향. interaction_mode:
  MOVE_AXIS(3)/MOVE_3D(7)/MOVE_ROTATE(6)/MOVE_ROTATE_3D(9) → 이동, ROTATE_AXIS(5)/ROTATE_3D(8) → 회전.
사용: python3 im_bridge.py <topic>   (예: /basic_controls, /marker_server)"""
import sys
import os
import json
import threading

MOVE_MODES = {3, 6, 7, 9}
ROT_MODES = {5, 8, 9}
FB = {'keep_alive': 0, 'pose_update': 1, 'menu_select': 2, 'button_click': 3,
      'mouse_down': 4, 'mouse_up': 5}


def q_rot(q, v):
    x, y, z, w = q
    t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])]
    return [v[0] + w * t[0] + (y * t[2] - z * t[1]),
            v[1] + w * t[1] + (z * t[0] - x * t[2]),
            v[2] + w * t[2] + (x * t[1] - y * t[0])]


def marker_json(m):
    """visualization_msgs/Marker → 3D 씬 마커 JSON(비주얼 지오메트리, im 프레임 상대 pose)."""
    p = m.pose.position
    o = m.pose.orientation
    col = [m.color.r, m.color.g, m.color.b, m.color.a] if m.color.a > 0 else [0.4, 0.6, 0.9, 1.0]
    pts = [[q.x, q.y, q.z] for q in getattr(m, 'points', [])]
    cols = [[c.r, c.g, c.b, c.a] for c in getattr(m, 'colors', [])]
    return {"type": int(m.type), "scale": [m.scale.x, m.scale.y, m.scale.z], "color": col,
            "pose": {"p": [p.x, p.y, p.z], "q": [o.x, o.y, o.z, o.w]}, "points": pts, "colors": cols}


def im_json(im):
    """InteractiveMarker → {name, frame_id, pose, scale, visual[], handles[]}."""
    p = im.pose.position
    o = im.pose.orientation
    scale = im.scale if im.scale and im.scale > 0 else 1.0
    visual, handles = [], []
    seen = set()
    for ctl in im.controls:
        for m in ctl.markers:
            visual.append(marker_json(m))
        mode = int(ctl.interaction_mode)
        if mode in MOVE_MODES or mode in ROT_MODES:
            co = ctl.orientation
            axis = q_rot([co.x, co.y, co.z, co.w], [1.0, 0.0, 0.0])
            for kind in (['move'] if mode in MOVE_MODES else []) + (['rotate'] if mode in ROT_MODES else []):
                key = (kind, round(axis[0], 3), round(axis[1], 3), round(axis[2], 3))
                if key in seen:
                    continue
                seen.add(key)
                handles.append({"mode": kind, "axis": axis, "name": ctl.name})
    return {"name": im.name, "frame_id": im.header.frame_id or "",
            "pose": {"p": [p.x, p.y, p.z], "q": [o.x, o.y, o.z, o.w]},
            "scale": scale, "visual": visual, "handles": handles}


def emit(state):
    sys.stdout.write(json.dumps({"ims": list(state.values())}) + "\n")
    sys.stdout.flush()


def main():
    topic = sys.argv[1] if len(sys.argv) > 1 else '/basic_controls'
    import rclpy
    from visualization_msgs.msg import InteractiveMarkerUpdate, InteractiveMarkerFeedback
    from geometry_msgs.msg import Pose
    from std_msgs.msg import Header
    rclpy.init()
    node = rclpy.create_node('rdash_im_bridge')
    state = {}          # name → im_json
    frames = {}         # name → frame_id (피드백 헤더용)

    def apply_update(msg):
        changed = False
        for name in getattr(msg, 'erases', []):
            if state.pop(name, None) is not None:
                frames.pop(name, None)
                changed = True
        for im in getattr(msg, 'markers', []):
            j = im_json(im)
            state[j['name']] = j
            frames[j['name']] = j['frame_id']
            changed = True
        for pu in getattr(msg, 'poses', []):
            j = state.get(pu.name)
            if j is not None:
                p, o = pu.pose.position, pu.pose.orientation
                j['pose'] = {"p": [p.x, p.y, p.z], "q": [o.x, o.y, o.z, o.w]}
                changed = True
        if changed:
            emit(state)

    node.create_subscription(InteractiveMarkerUpdate, topic + '/update', apply_update, 10)

    # 초기 전체 상태 — ROS2 는 get_interactive_markers 서비스로, 실패해도 /update 로 결국 채워짐.
    def fetch_full():
        try:
            from visualization_msgs.srv import GetInteractiveMarkers
            cli = node.create_client(GetInteractiveMarkers, topic + '/get_interactive_markers')
            if cli.wait_for_service(timeout_sec=3.0):
                fut = cli.call_async(GetInteractiveMarkers.Request())
                rclpy.spin_until_future_complete(node, fut, timeout_sec=3.0)
                res = fut.result()
                if res is not None:
                    for im in res.markers:
                        j = im_json(im)
                        state[j['name']] = j
                        frames[j['name']] = j['frame_id']
                    if state:
                        emit(state)
        except Exception:
            pass
    threading.Thread(target=fetch_full, daemon=True).start()

    fb_pub = node.create_publisher(InteractiveMarkerFeedback, topic + '/feedback', 10)

    def feedback_reader():
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            name = d.get('name')
            pose = d.get('pose') or {}
            p = pose.get('p', [0, 0, 0])
            q = pose.get('q', [0, 0, 0, 1])
            fb = InteractiveMarkerFeedback()
            fb.header = Header()
            fb.header.frame_id = frames.get(name, '') or (state.get(name, {}).get('frame_id', ''))
            fb.header.stamp = node.get_clock().now().to_msg()
            fb.client_id = 'rdash'
            fb.marker_name = name or ''
            fb.control_name = d.get('control', '')
            fb.event_type = FB.get(d.get('event', 'pose_update'), 1)
            po = Pose()
            po.position.x, po.position.y, po.position.z = float(p[0]), float(p[1]), float(p[2])
            po.orientation.x, po.orientation.y, po.orientation.z, po.orientation.w = \
                float(q[0]), float(q[1]), float(q[2]), float(q[3])
            fb.pose = po
            # 로컬 좌표(브라우저가 계산) → 헤더 프레임 그대로. RViz 규약: pose 는 header.frame_id 기준.
            try:
                fb_pub.publish(fb)
            except Exception:
                pass
    threading.Thread(target=feedback_reader, daemon=True).start()

    rclpy.spin(node)


if __name__ == '__main__':
    main()
