#!/usr/bin/env bash
# 대시보드 테스트용 turtlesim 기동 — ROS 환경(rostopic 되는 셸)에서 실행.
# turtlesim 은 토픽/서비스/파라미터/노드를 전부 제공해서 대시보드 검증에 딱 좋다.
#   1) 이 스크립트 실행 → turtlesim + 자동 이동
#   2) 다른 셸에서  node index.js  → 트리에서 topics/services/params/nodes 둘러보기
set -e

if ! command -v turtlesim_node >/dev/null 2>&1; then
  echo "[turtlesim] 설치..."
  (sudo apt-get update && sudo apt-get install -y ros-noetic-turtlesim) 2>/dev/null \
    || { apt-get update && apt-get install -y ros-noetic-turtlesim; }
fi

# master 없으면 roscore 기동
if ! rostopic list >/dev/null 2>&1; then
  echo "[turtlesim] roscore 시작..."
  roscore >/tmp/roscore.log 2>&1 &
  sleep 5
fi

echo "[turtlesim] turtlesim_node 시작 (창이 뜨려면 DISPLAY 필요)..."
rosrun turtlesim turtlesim_node >/tmp/turtlesim.log 2>&1 &
sleep 3

echo "[turtlesim] 거북이 자동 이동 — Ctrl-C 로 종료. 이제 다른 셸에서 대시보드 실행."
exec rostopic pub -r 3 /turtle1/cmd_vel geometry_msgs/Twist \
  "{linear: {x: 1.0, y: 0.0, z: 0.0}, angular: {x: 0.0, y: 0.0, z: 0.7}}"
