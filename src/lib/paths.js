// 저장소 루트 기준 경로 + 텔레메트리 스크립트 로드(한 번). src/lib → 루트는 두 단계 위.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PLOT_PY = join(ROOT, 'plot.py');   // matplotlib 라이브 플로터(원값/미분/적분/FFT)
export const TF_TREE_PY = join(ROOT, 'tf_tree.py');   // /tf → 프레임 트리 파서
export const IMG_BRIDGE = join(ROOT, 'img_bridge.py');     // CompressedImage/Image → base64 JPEG 스트림
export const CLOUD_BRIDGE = join(ROOT, 'cloud_bridge.py'); // PointCloud2 → base64 float32 xyz 스트림
export const BAG_DUMP = join(ROOT, 'bag_dump.py');         // rosbag2 → 숫자 리프 시계열 JSON (PlotLab 파일 재생)
export const ECHO_MUX = join(ROOT, 'ros_echo_mux.py');     // 단일 rclpy 노드 echo 멀티플렉서(프로세스 폭증 해결)
export const MARKER_BRIDGE = join(ROOT, 'marker_bridge.py'); // visualization_msgs/Marker(Array) → JSON 스트림 (3D 씬)
export const TF_DUMP = join(ROOT, 'tf_dump.py');           // /tf → 루트 기준 프레임 변환 JSON 스트림 (3D 씬)
export const IMG_ANN_BRIDGE = join(ROOT, 'img_ann_bridge.py'); // 검출/주석 → JSON (이미지 오버레이)
export const CAMINFO_BRIDGE = join(ROOT, 'caminfo_bridge.py'); // CameraInfo → 보정 파라미터 JSON (이미지 오버레이)
export const GEOM_BRIDGE = join(ROOT, 'geom_bridge.py');   // LaserScan/Path/Odometry/Pose*/OccupancyGrid → 마커 JSON (3D 씬)
export const URDF_BRIDGE = join(ROOT, 'urdf_bridge.py');   // robot_description(URDF) → 링크 비주얼 마커(TRIANGLE_LIST 메시) (3D 씬)
export const IM_BRIDGE = join(ROOT, 'im_bridge.py');       // InteractiveMarker(6-DOF) ↔ 피드백(양방향) JSON (3D 씬)
export const TELEM = readFileSync(join(ROOT, 'telemetry.py'), 'utf8');
export const TELEM2 = readFileSync(join(ROOT, 'telemetry_ros2.py'), 'utf8');
