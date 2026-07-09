#!/usr/bin/env bash
# ROS2 대시보드 테스트 — turtlesim(GUI). ros2 환경 + X11 마운트 컨테이너(superpx4_ros2)에서 실행.
#   1) 이 스크립트 → turtlesim 창 + 자동 이동 (토픽/서비스/노드 생김)
#   2) 다른 셸에서  node index.js  → 헤더 ROS2, 트리에서 둘러보기  (Ctrl-C 종료)
# X11 없으면 turtlesim 실패 → 헤드리스 demo 노드로 자동 폴백.
set -e
source /opt/ros/humble/setup.bash 2>/dev/null || true
export LD_LIBRARY_PATH=/usr/lib/wsl/lib:$LD_LIBRARY_PATH   # WSLg GPU(D3D12)

# ros2 CLI 데몬 재시작(그래프 조회 실패 방지)
ros2 daemon stop >/dev/null 2>&1 || true; ros2 daemon start >/dev/null 2>&1 || true

if ros2 pkg prefix turtlesim >/dev/null 2>&1 && [ -n "$DISPLAY" ] && [ -d /tmp/.X11-unix ]; then
  echo "[ros2 test] turtlesim 창 + 자동 이동. Ctrl-C 종료. 다른 셸에서 대시보드 실행."
  ros2 run turtlesim turtlesim_node >/tmp/turtlesim2.log 2>&1 &
  sleep 3
  exec ros2 topic pub -r 3 /turtle1/cmd_vel geometry_msgs/msg/Twist \
    "{linear: {x: 1.0, y: 0.0, z: 0.0}, angular: {x: 0.0, y: 0.0, z: 0.7}}"
else
  echo "[ros2 test] X11/turtlesim 불가 → 헤드리스 demo 노드로 폴백."
  ros2 run demo_nodes_cpp listener >/tmp/listener.log 2>&1 &
  exec ros2 run demo_nodes_cpp talker
fi
