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
export const TELEM = readFileSync(join(ROOT, 'telemetry.py'), 'utf8');
export const TELEM2 = readFileSync(join(ROOT, 'telemetry_ros2.py'), 'utf8');
