# -*- coding: utf-8 -*-
"""ROS1(rospy)/ROS2(rclpy) 호환 레이어 — 3D 씬 브리지 공유.
브리지는 토픽을 구독해 stdout 으로 스트리밍만 하므로 버전 의존부(init/subscribe/
publish/spin/QoS)만 흡수한다. 콜백의 메시지 필드 접근은 ROS1/ROS2 동일."""
import os


def ros_version():
    v = os.environ.get('ROS_VERSION')
    if v in ('1', '2'):
        return int(v)
    try:
        import rclpy  # noqa: F401
        return 2
    except Exception:
        return 1


class Bridge:
    """단일 구독 노드 추상화. v==1 → rospy, v==2 → rclpy."""

    def __init__(self, name):
        self.v = ros_version()
        if self.v == 2:
            import rclpy
            self._rclpy = rclpy
            if not rclpy.ok():
                rclpy.init()
            self.node = rclpy.create_node(name)
        else:
            import rospy
            self._rospy = rospy
            # anonymous: 웹은 토픽마다 브리지 프로세스를 따로 띄운다 → 노드명 충돌 방지.
            rospy.init_node(name, anonymous=True, disable_signals=True)

    def subscribe(self, msg_type, topic, cb, best_effort=True, transient_local=False, depth=10):
        if self.v == 2:
            from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy, HistoryPolicy
            qos = QoSProfile(depth=depth, history=HistoryPolicy.KEEP_LAST)
            qos.reliability = ReliabilityPolicy.BEST_EFFORT if best_effort else ReliabilityPolicy.RELIABLE
            if transient_local:
                qos.durability = DurabilityPolicy.TRANSIENT_LOCAL
            self.node.create_subscription(msg_type, topic, cb, qos)
        else:
            self._rospy.Subscriber(topic, msg_type, cb, queue_size=depth)

    def publisher(self, msg_type, topic, depth=10):
        if self.v == 2:
            return self.node.create_publisher(msg_type, topic, depth)
        return self._rospy.Publisher(topic, msg_type, queue_size=depth)

    def now_msg(self):
        if self.v == 2:
            return self.node.get_clock().now().to_msg()
        return self._rospy.Time.now()

    def topic_types(self):
        """[(name, [type_str, ...]), ...] — 그래프 토픽 타입 조회(geom 용)."""
        if self.v == 2:
            return self.node.get_topic_names_and_types()
        return [(n, [t]) for n, t in self._rospy.get_published_topics()]

    def spin(self):
        if self.v == 2:
            self._rclpy.spin(self.node)
        else:
            self._rospy.spin()
