#!/usr/bin/env python3
"""CameraInfo 브리지 — sensor_msgs/CameraInfo 를 구독해 보정(캘리브레이션) 파라미터를 한 줄 JSON 으로.
웹 이미지 패널(web/server.js /caminfostream)이 SSE 로 받아 주점(principal point)·초점 레티클을 오버레이한다.
사용: python3 caminfo_bridge.py <topic>
출력: {"width":W,"height":H,"K":[fx,0,cx,0,fy,cy,0,0,1],"D":[..],"model":"plumb_bob","frame_id":".."}"""
import sys
import json


def main():
    topic = sys.argv[1] if len(sys.argv) > 1 else '/camera/camera_info'
    import rclpy
    rclpy.init()
    node = rclpy.create_node('rdash_caminfo_bridge')
    from sensor_msgs.msg import CameraInfo

    def emit(m):
        try:
            sys.stdout.write(json.dumps({
                "width": int(m.width), "height": int(m.height),
                "K": [float(x) for x in m.k], "D": [float(x) for x in m.d],
                "model": str(m.distortion_model), "frame_id": m.header.frame_id,
            }) + "\n")
            sys.stdout.flush()
        except Exception:
            pass

    node.create_subscription(CameraInfo, topic, emit, 10)
    rclpy.spin(node)


if __name__ == '__main__':
    main()
