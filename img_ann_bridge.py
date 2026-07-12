#!/usr/bin/env python3
"""이미지 어노테이션 브리지 — 검출/주석 토픽을 구독해 한 줄 JSON 으로 stdout.
웹 이미지 패널(web/server.js /annstream)이 SSE 로 받아 이미지 위 오버레이 캔버스에 그린다.
사용: python3 img_ann_bridge.py <topic> [type]
지원:
  · vision_msgs/Detection2DArray, Detection2D  → boxes:[{cx,cy,w,h,label,score}]
  · foxglove_msgs/ImageAnnotations             → points/circles/texts (원 좌표계 = 픽셀)
출력: {"boxes":[...],"points":[[x,y,r,g,b]..],"circles":[{x,y,d,r,g,b}..],"texts":[{x,y,t}..]}"""
import sys
import json


def det_boxes(msg):
    out = []
    for d in msg.detections:
        b = d.bbox
        # ROS2 humble: center 는 Pose2D(position.x/y, theta); 구버전은 center.x/y
        cx = getattr(getattr(b.center, 'position', b.center), 'x', 0.0)
        cy = getattr(getattr(b.center, 'position', b.center), 'y', 0.0)
        label, score = '', 0.0
        if d.results:
            r0 = d.results[0]
            label = str(getattr(getattr(r0, 'hypothesis', r0), 'class_id', ''))
            score = float(getattr(getattr(r0, 'hypothesis', r0), 'score', 0.0))
        out.append({"cx": float(cx), "cy": float(cy), "w": float(b.size_x), "h": float(b.size_y),
                    "label": label, "score": round(score, 3)})
    return out


def fg_annotations(msg):
    pts, circles, texts = [], [], []
    for p in getattr(msg, 'points', []):
        c = getattr(p, 'outline_color', None) or (p.outline_colors[0] if getattr(p, 'outline_colors', None) else None)
        rgb = [int((c.r if c else 1) * 255), int((c.g if c else 1) * 255), int((c.b if c else 0.3) * 255)]
        for q in p.points:
            pts.append([float(q.x), float(q.y)] + rgb)
    for c in getattr(msg, 'circles', []):
        col = getattr(c, 'outline_color', None)
        circles.append({"x": float(c.position.x), "y": float(c.position.y), "d": float(c.diameter),
                        "r": int((col.r if col else 1) * 255), "g": int((col.g if col else 0.8) * 255),
                        "b": int((col.b if col else 0.2) * 255)})
    for t in getattr(msg, 'texts', []):
        texts.append({"x": float(t.position.x), "y": float(t.position.y), "t": str(t.text)})
    return pts, circles, texts


def main():
    topic = sys.argv[1] if len(sys.argv) > 1 else '/detections'
    import rclpy
    rclpy.init()
    node = rclpy.create_node('rdash_img_ann_bridge')

    def emit(o):
        try:
            sys.stdout.write(json.dumps(o) + "\n")
            sys.stdout.flush()
        except Exception:
            pass

    ty = None
    for n, ts in node.get_topic_names_and_types():
        if n == topic and ts:
            ty = ts[0]
    if ty and 'ImageAnnotations' in ty:
        from foxglove_msgs.msg import ImageAnnotations
        node.create_subscription(ImageAnnotations, topic,
                                 lambda m: emit(dict(zip(("points", "circles", "texts"), fg_annotations(m)),
                                                     boxes=[])), 10)
    else:
        from vision_msgs.msg import Detection2DArray
        node.create_subscription(Detection2DArray, topic,
                                 lambda m: emit({"boxes": det_boxes(m), "points": [], "circles": [], "texts": []}), 10)
    rclpy.spin(node)


if __name__ == '__main__':
    main()
