#!/usr/bin/env python3
"""기하 브리지 — RViz 식 네이티브 디스플레이 타입을 구독해 마커 JSON 으로 변환(3D 씬이 그대로 렌더).
지원: sensor_msgs/LaserScan, nav_msgs/Path, nav_msgs/Odometry, geometry_msgs/PoseArray,
      geometry_msgs/PoseStamped, geometry_msgs/PointStamped, nav_msgs/OccupancyGrid,
      px4_msgs/VehicleOdometry (PX4). Odometry 계열은 지나온 궤적(trail)을 라인으로 누적.
출력(메시지당 한 줄): {"markers":[{ns,id,type,action,frame_id,pose:{p,q},scale,color,points,colors,text}]}
사용: python3 geom_bridge.py <topic> <type>   (type 은 ROS 타입 문자열; 미지정 시 자동 감지)"""
import sys
import os
import json

TRAIL = []   # 오도메트리 궤적 누적(현재 프로세스=한 토픽)
MAXTRAIL = int(os.environ.get('RDASH_TRAIL_MAX', '3000') or 3000)


def emit(markers):
    try:
        sys.stdout.write(json.dumps({"markers": markers}) + "\n")
        sys.stdout.flush()
    except Exception:
        pass


def mk(**kw):
    m = {"ns": "geom", "id": 0, "type": 8, "action": 0, "frame_id": "map",
         "pose": {"p": [0, 0, 0], "q": [0, 0, 0, 1]}, "scale": [0.05, 0.05, 0.05],
         "color": [0.4, 0.8, 0.9, 1], "points": [], "colors": [], "text": ""}
    m.update(kw)
    return m


def laserscan(msg):
    import math
    pts = []
    a = msg.angle_min
    for r in msg.ranges:
        if r == r and msg.range_min <= r <= msg.range_max:   # NaN/범위 필터
            pts.append([r * math.cos(a), r * math.sin(a), 0.0])
        a += msg.angle_increment
    return [mk(id=1, type=8, frame_id=msg.header.frame_id, scale=[0.04, 0.04, 0.04],
               color=[0.34, 0.85, 0.9, 1], points=pts)]


def path(msg):
    pts = [[p.pose.position.x, p.pose.position.y, p.pose.position.z] for p in msg.poses]
    fid = msg.header.frame_id
    out = [mk(id=1, type=4, frame_id=fid, scale=[0.03, 0, 0], color=[0.44, 0.82, 0.55, 1], points=pts)]
    return out


def _arrow(pose, fid, mid, color, length=0.6):
    p, o = pose.position, pose.orientation
    return _arrow_pq([p.x, p.y, p.z], [o.x, o.y, o.z, o.w], fid, mid, color, length)


def _arrow_pq(pos, q, fid, mid, color, length=0.6):
    return mk(id=mid, type=0, frame_id=fid, pose={"p": [float(v) for v in pos], "q": [float(v) for v in q]},
              scale=[length, 0.08, 0.12], color=color)


def _trail(pos, fid, color):
    """현재 위치를 궤적에 누적하고 LINE_STRIP 마커로 반환(지나온 경로)."""
    TRAIL.append([float(v) for v in pos])
    if len(TRAIL) > MAXTRAIL:
        del TRAIL[0]
    return mk(id=99, type=4, frame_id=fid, scale=[0.05, 0, 0], color=color, points=[list(p) for p in TRAIL])


def odometry(msg):
    p, o = msg.pose.pose.position, msg.pose.pose.orientation
    fid = msg.header.frame_id
    return [_arrow_pq([p.x, p.y, p.z], [o.x, o.y, o.z, o.w], fid, 1, [0.9, 0.7, 0.3, 1], 0.7),
            _trail([p.x, p.y, p.z], fid, [0.44, 0.82, 0.55, 1])]


def vehicle_odometry(msg):
    """PX4 px4_msgs/VehicleOdometry — position + q([w,x,y,z]). ROS 쿼터니언 순서로 재정렬."""
    pos = [msg.position[0], msg.position[1], msg.position[2]]
    q = [msg.q[1], msg.q[2], msg.q[3], msg.q[0]]   # [w,x,y,z] → [x,y,z,w]
    fid = 'odom'
    return [_arrow_pq(pos, q, fid, 1, [0.9, 0.5, 0.3, 1], 0.8),
            _trail(pos, fid, [0.9, 0.6, 0.35, 1])]


def posestamped(msg):
    return [_arrow(msg.pose, msg.header.frame_id, 1, [0.44, 0.6, 0.95, 1], 0.6)]


def posearray(msg):
    return [_arrow(p, msg.header.frame_id, i + 1, [0.78, 0.54, 0.82, 1], 0.4) for i, p in enumerate(msg.poses)]


def pointstamped(msg):
    p = msg.point
    return [mk(id=1, type=2, frame_id=msg.header.frame_id, pose={"p": [p.x, p.y, p.z], "q": [0, 0, 0, 1]},
               scale=[0.2, 0.2, 0.2], color=[0.9, 0.42, 0.42, 1])]


def occupancygrid(msg, cap=40000):
    info = msg.info
    res, w, h = info.resolution, info.width, info.height
    ox, oy = info.origin.position.x, info.origin.position.y
    pts, cols = [], []
    step = max(1, int((w * h / cap) ** 0.5))
    for j in range(0, h, step):
        for i in range(0, w, step):
            v = msg.data[j * w + i]
            if v < 0:
                continue
            g = 1.0 - v / 100.0
            pts.append([ox + (i + 0.5) * res, oy + (j + 0.5) * res, 0.0])
            cols.append([g, g, g, 1.0])
    return [mk(id=1, type=8, frame_id=msg.header.frame_id, scale=[res * step, res * step, 1],
               color=[0.7, 0.7, 0.7, 1], points=pts, colors=cols)]


HANDLERS = [
    ("LaserScan", "sensor_msgs.msg", "LaserScan", laserscan),
    ("Path", "nav_msgs.msg", "Path", path),
    ("Odometry", "nav_msgs.msg", "Odometry", odometry),
    ("PoseArray", "geometry_msgs.msg", "PoseArray", posearray),
    ("PoseStamped", "geometry_msgs.msg", "PoseStamped", posestamped),
    ("PointStamped", "geometry_msgs.msg", "PointStamped", pointstamped),
    ("OccupancyGrid", "nav_msgs.msg", "OccupancyGrid", occupancygrid),
    ("VehicleOdometry", "px4_msgs.msg", "VehicleOdometry", vehicle_odometry),
]


def main():
    topic = sys.argv[1] if len(sys.argv) > 1 else '/scan'
    tyarg = sys.argv[2] if len(sys.argv) > 2 else ''
    from importlib import import_module
    from ros_compat import Bridge
    b = Bridge('rdash_geom_bridge')

    # 타입 결정: 인자 우선, 없으면 그래프에서 조회.
    if not tyarg:
        for n, ts in b.topic_types():
            if n == topic and ts:
                tyarg = ts[0]
    match = next((h for h in HANDLERS if h[0] in tyarg), None)
    if not match:
        emit([])
        return
    _, mod, cls, fn = match
    MsgType = getattr(import_module(mod), cls)
    b.subscribe(MsgType, topic, lambda m: emit(fn(m)))
    b.spin()


if __name__ == '__main__':
    main()
