// 저장소 루트 기준 경로 + 텔레메트리 스크립트 로드(한 번). shared/ → 루트는 한 단계 위.
//
// 파이썬은 backend/python/ 아래 기능별로 나뉜다:
//   common/     ros_compat.py — ROS1(rospy)/ROS2(rclpy) 를 같은 API 로 덮는 shim. 브리지 8 개가 import 한다.
//               → 하위 디렉토리에서 `import ros_compat` 이 되도록 rosSpawn(shared/ros.js)이 PYTHONPATH 에 PY_COMMON 을 넣는다.
//   telemetry/  그래프 스냅샷 스트림(그대로 stdin 으로 넘겨 실행 → 경로 의존 없음)
//   scene3d/    3D 씬용 브리지(마커·기하·URDF·인터랙티브 마커·포인트클라우드·TF)
//   image/      카메라 이미지·주석·보정 브리지
//   stream/     echo 멀티플렉서(토픽마다 프로세스 띄우던 것을 한 노드로)
//   tools/      단발 도구(플로터·rosbag 덤프·TF 트리)
//
// 이 파일이 파이썬 경로의 유일한 창구다. 스크립트를 옮기면 여기만 고치면 된다.
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PY = join(ROOT, 'backend', 'python');

export const PY_COMMON = join(PY, 'common');   // PYTHONPATH 에 들어간다 — ros_compat import 용

export const BAG_DUMP = join(PY, 'tools', 'bag_dump.py');   // rosbag2 → 숫자 리프 시계열 JSON (PlotLab 파일 재생)
export const TF_TREE_PY = join(PY, 'tools', 'tf_tree.py');  // /tf → 프레임 트리 파서


export const MARKER_BRIDGE = join(PY, 'scene3d', 'marker_bridge.py'); // visualization_msgs/Marker(Array) → JSON 스트림
export const TF_DUMP = join(PY, 'scene3d', 'tf_dump.py');             // /tf → 루트 기준 프레임 변환 JSON 스트림
export const GEOM_BRIDGE = join(PY, 'scene3d', 'geom_bridge.py');     // LaserScan/Path/Odometry/Pose*/OccupancyGrid → 마커 JSON
export const URDF_BRIDGE = join(PY, 'scene3d', 'urdf_bridge.py');     // robot_description(URDF) → 링크 비주얼 마커(TRIANGLE_LIST 메시)
export const IM_BRIDGE = join(PY, 'scene3d', 'im_bridge.py');         // InteractiveMarker(6-DOF) ↔ 피드백(양방향) JSON
export const CLOUD_BRIDGE = join(PY, 'scene3d', 'cloud_bridge.py');   // PointCloud2 → base64 float32 xyz 스트림

export const IMG_BRIDGE = join(PY, 'image', 'img_bridge.py');         // CompressedImage/Image → base64 JPEG 스트림
export const IMG_ANN_BRIDGE = join(PY, 'image', 'img_ann_bridge.py'); // 검출/주석 → JSON (이미지 오버레이)
export const CAMINFO_BRIDGE = join(PY, 'image', 'caminfo_bridge.py'); // CameraInfo → 보정 파라미터 JSON (이미지 오버레이)

