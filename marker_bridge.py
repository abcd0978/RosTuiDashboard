#!/usr/bin/env python3
"""마커 브리지 — visualization_msgs/Marker(Array) 토픽을 구독해 마커를 깔끔한 JSON 한 줄씩 stdout 으로.
웹 3D 씬(web/server.js /markerstream)이 SSE 로 받아 WebGL 로 렌더한다. 사용: python3 marker_bridge.py <topic>
출력: {"markers":[{ns,id,type,action,frame_id,pose:{p:[x,y,z],q:[x,y,z,w]},scale:[x,y,z],color:[r,g,b,a],points:[[x,y,z]..],colors:[[r,g,b,a]..],text}]}"""
import sys
import json


def mk(m):
    p, o, s, c = m.pose.position, m.pose.orientation, m.scale, m.color
    return {
        "ns": m.ns, "id": m.id, "type": int(m.type), "action": int(m.action),
        "frame_id": m.header.frame_id,
        "pose": {"p": [p.x, p.y, p.z], "q": [o.x, o.y, o.z, o.w]},
        "scale": [s.x, s.y, s.z], "color": [c.r, c.g, c.b, c.a],
        "points": [[q.x, q.y, q.z] for q in m.points],
        "colors": [[q.r, q.g, q.b, q.a] for q in m.colors],
        "text": m.text,
    }


def main():
    topic = sys.argv[1] if len(sys.argv) > 1 else '/visualization_marker_array'
    import rclpy
    rclpy.init()
    node = rclpy.create_node('rdash_marker_bridge')

    def emit(markers):
        try:
            sys.stdout.write(json.dumps({"markers": markers}) + "\n")
            sys.stdout.flush()
        except Exception:
            pass

    # 타입 자동 감지: 토픽 타입으로 Marker / MarkerArray 결정.
    ty = None
    for n, ts in node.get_topic_names_and_types():
        if n == topic and ts:
            ty = ts[0]
    from visualization_msgs.msg import Marker, MarkerArray
    if ty and 'MarkerArray' in ty or 'array' in topic:
        node.create_subscription(MarkerArray, topic, lambda a: emit([mk(m) for m in a.markers]), 10)
    else:
        node.create_subscription(Marker, topic, lambda m: emit([mk(m)]), 10)
    rclpy.spin(node)


if __name__ == '__main__':
    main()
