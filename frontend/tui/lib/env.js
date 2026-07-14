// 컨테이너/환경 컨텍스트 — 어느 컨테이너·도메인의 ROS 그래프를 보는지 표시용.
// 컨테이너는 서로 격리돼 있어 기본적으론 자기 그래프만 보이지만, ROS2 는 ROS_DOMAIN_ID 로
// 논리 분리되므로 도메인을 바꾸면 (DDS 로 도달 가능한) 다른 컨테이너의 그래프를 엿볼 수 있다.
import os from 'os';

export function rosEnv(ver, domain) {
  return {
    host: os.hostname(),
    domain: (domain != null && domain !== '') ? String(domain) : (process.env.ROS_DOMAIN_ID || '0'),
    rmw: (process.env.RMW_IMPLEMENTATION || 'default').replace('rmw_', '').replace('_cpp', ''),
    master: process.env.ROS_MASTER_URI || '',   // ROS1
    ver,
  };
}
