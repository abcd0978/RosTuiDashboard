# 기능 격차 — RViz / PlotJuggler 대비

RDash가 아직 못 따라간 기능 목록. (RDash가 부분적으로 가진 건 **부분**으로 표시)
최신 상태 기준으로 갱신하며 관리한다.

---

## RViz에 있고 RDash에 없는 것

### 디스플레이(메시지) 타입
- **Range** (`sensor_msgs/Range` — 초음파/ToF 콘)
- **WrenchStamped** (힘/토크 화살표)
- **PolygonStamped** (다각형), **GridCells** (`nav_msgs/GridCells`)
- **PoseWithCovarianceStamped / Odometry 공분산 타원** — RDash는 Odometry 궤적만, 공분산 시각화 없음
- **DepthCloud** (depth image + RGB → 클라우드)
- **Effort** (조인트 토크), **Temperature/Illuminance/FluidPressure/RelativeHumidity** 포인트 표시
- **Camera 디스플레이** — 그 카메라 시점에서 3D 지오메트리를 실제 카메라 영상 위에 렌더/오버레이
  (RDash는 이미지를 FOV 쿼드로 투영만; "카메라 뷰로 씬 보기"는 없음)
- **Map costmap 색 스킴** (map / costmap / raw) — RDash OccupancyGrid는 단일 스킴
- **Marker 메시 텍스처/재질** — RDash는 메시 지오메트리만(단색), `.dae`/`.obj`의 텍스처·재질 미적용

### 렌더 / 표시 옵션
- **Decay Time / 누적(history)** — 클라우드·포즈·마커를 N초간 잔상으로 축적 (RDash는 매 프레임 교체)
- **포인트 렌더 스타일** — Boxes / Spheres / Billboards / Flat Squares (RDash는 원/사각 점만)
- **임의 필드 색상 변환기** — 축(Axis) 지정·min/max 수동·autocompute (RDash는 height/intensity/rgb/flat 고정)
- **Marker lifetime / frame_locked** 준수 (자동 만료)
- **MarkerArray 네임스페이스 트리** — ns별 on/off (RDash는 토픽 단위만)
- **Grid 상세 설정** — 셀 개수/크기/평면(XY/XZ/YZ)/오프셋/색 (RDash는 grid 제거됨)
- **Axes 디스플레이** — 임의 프레임 축을 길이/반경 지정 (RDash는 월드 축만)
- **배경색 / 조명** 설정
- **RobotModel** — 충돌(collision) 지오메트리 토글, 링크별 on/off·alpha, 메시 재질/텍스처

### 상호작용 / 툴
- **Select 툴** — 박스 선택으로 객체/점 다중 선택 → 속성 표시·선택 점 발행 (RDash는 단일 점 조회만)
- **임의 마커/객체 클릭 선택** → 속성 표시 (RDash 픽은 클라우드 점·인터랙티브 마커 한정)
- **Focus 카메라** 툴 (클릭 지점으로 중심 이동)

### 뷰 / 카메라
- **뷰 컨트롤러 종류** — FPS(1인칭), ThirdPersonFollower, XYOrbit (RDash는 Orbit+Ortho+Follow만)
- **명명된 뷰포트 저장/복원** (Views 패널) — RDash는 프리셋(Top/Front/Side/Iso)만
- **시뮬레이션 시간 일시정지 연동** 표시 (RDash는 wall/sim 표시만)

### 상태 / 디버깅
- **디스플레이별 상태(OK/Warn/Error)** — "No transform from A to B", "메시지 수신 없음" 등 원인 메시지
  (RDash는 디스플레이별 오류 리포트 없음) ← RViz 대비 가장 큰 실질 격차
- **TF 옵션** — 프레임별 on/off, 이름 표시 토글, frame timeout, 화살표/축 스케일 (RDash는 전체 프레임 일괄)

### 설정 / 영속
- **전체 디스플레이 구성 저장/불러오기** (`.rviz` 파일 상당) — RDash는 워크스페이스 레이아웃만 저장,
  디스플레이 구성 export/import 없음
- **3D 뷰 스크린샷 저장 버튼** (사용자용)

---

## PlotJuggler에 있고 RDash에 없는 것

### 데이터 소스 / 임포트
- **CSV 임포트**해서 플롯 (RDash는 CSV export만, import 없음)
- **ULog(PX4) / MCAP** 파일 로드 (RDash는 rosbag만)
- **bag + 라이브 병합** — PlotJuggler는 로드 데이터와 스트림 동시 (RDash는 bag이 교체)

### 변환 / 함수
- **저역통과 필터**(1·2차), **Moving RMS**, **이상치 제거** 등 추가 변환
  (RDash: 미분/적분/이동평균/절대값/FFT/커스텀식)
- **Lua 함수 에디터** — 재사용 명명 함수로 파생 시계열 생성 (RDash는 JS 인라인 수식 `c0-c1`)
- **시리즈 시간 오프셋/정렬** (커브별 time shift)
- **정규식/일괄 커브 추가** (패턴으로 여러 시리즈 한 번에)

### 레이아웃 / 뷰
- **탭 레이아웃** — 여러 탭에 다른 플롯 세트 (RDash는 격자 하나)
- **레이아웃 파일 저장/불러오기**(.xml) — 커브·변환·배치까지 (RDash는 **부분**: 워크스페이스만)
- **줌 옵션** — 박스 줌, zoom-to-fit, 축별 줌 잠금, 플롯 간 줌 링크 (RDash는 시간축만 공유, Y 독립)
- **커브 스타일** — 선 두께/점 표시/스타일 커스터마이즈 (RDash는 색만 자동)

### 상호작용 / 주석
- **주석 / 수직 마커(annotations)** — 시간축에 이벤트 표시 (RDash 없음)
- ~~데이터 포인트 테이블 — 커서 시점 값 표~~ → **RDash에 구현됨 ✓** (커서 값 테이블)

### 출력 / 퍼블리시
- **Publisher / Re-publisher 플러그인** — 변환한 데이터를 다시 ROS 토픽으로 발행 (RDash 없음)
- **State Publisher** — 재생 중 상태를 ROS로 스트림
- **다른 포맷 export** (rosbag 등)

---

## 참고 — RDash가 오히려 앞서는 것
- 🩺 Doctor(자동 QoS/stale/dead-end 진단), 📌 Baseline 회귀 비교, 🔴 Trigger 자동 캡처
- 📊 노드 프로세스 CPU/RSS, 🔍 3D 포인트 조회, 씬 우클릭 → Nav Goal/Point
- 웹 기반(SSH·원격 rosbridge), 3D 씬 + 멀티플롯이 한 앱에 통합
