#!/usr/bin/env python3
"""이미지 브리지 — CompressedImage/Image 토픽을 구독해 프레임을 base64 JPEG 한 줄씩 stdout 으로.
웹 이미지 패널(web/server.js /imgstream)이 이걸 SSE 로 흘려 <img> 에 그린다.
사용: python3 img_bridge.py <topic>  ('/...compressed' 면 압축, 아니면 raw Image 를 JPEG 로 변환)"""
import sys
import base64
import io


def main():
    topic = sys.argv[1] if len(sys.argv) > 1 else '/camera/image_raw/compressed'
    import rclpy
    rclpy.init()
    node = rclpy.create_node('rdash_img_bridge')
    out = sys.stdout

    def emit(jpeg_bytes):
        try:
            out.write(base64.b64encode(jpeg_bytes).decode() + '\n')
            out.flush()
        except Exception:
            pass

    if 'compressed' in topic.lower():
        from sensor_msgs.msg import CompressedImage
        node.create_subscription(CompressedImage, topic, lambda m: emit(bytes(m.data)), 10)
    else:
        from sensor_msgs.msg import Image
        import numpy as np
        from PIL import Image as PILImage

        def cb(msg):
            try:
                enc = (msg.encoding or 'rgb8').lower()
                arr = np.frombuffer(bytes(msg.data), dtype=np.uint8)
                if enc in ('rgb8', 'bgr8'):
                    im = arr.reshape((msg.height, msg.width, 3))
                    if enc == 'bgr8':
                        im = im[:, :, ::-1]
                    pim = PILImage.fromarray(im, 'RGB')
                elif enc in ('mono8', '8uc1'):
                    pim = PILImage.fromarray(arr.reshape((msg.height, msg.width)), 'L')
                else:
                    return
                buf = io.BytesIO()
                pim.save(buf, 'JPEG', quality=70)
                emit(buf.getvalue())
            except Exception:
                pass
        node.create_subscription(Image, topic, cb, 10)

    rclpy.spin(node)


if __name__ == '__main__':
    main()
