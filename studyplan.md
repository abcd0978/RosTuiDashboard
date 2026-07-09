# PX4 + FAST-LIO + SUPER 학습 플랜 (with RDash)

> 목표: **LiDAR 기반 자율 고속 드론 내비게이션 스택**을 이해하고 시뮬레이션에서 끝까지 돌려보기.
> 학습 도구로 **RDash**(이 저장소의 TUI)를 각 단계의 "관찰 장비"로 쓴다.
> 예상 기간: **8~10주** (하루 1~2시간 기준. 주차별 일정은 맨 아래.)

## 0. 큰 그림 — 데이터가 어떻게 흐르나

```
 LiDAR + IMU ──▶ FAST-LIO ──▶ odometry(위치/자세) ─┬─▶ PX4 EKF2 (vision fusion, /fmu/in/vehicle_visual_odometry)
                    │                                │
                    └─▶ registered cloud / local map ├─▶ SUPER planner ──▶ trajectory setpoint ──▶ PX4 offboard
                                                     │        (goal 입력)      (pos/vel/acc/jerk)
                                                  RViz(3D 확인) + RDash(그래프/Hz/플롯/제어)
```

| 컴포넌트 | 역할 | 한 줄 |
|---|---|---|
| **PX4** | 오토파일럿 | 자세/위치 **제어**(cascade PID + EKF2), SITL 시뮬, offboard 입력 수신 |
| **FAST-LIO** | 상태추정(SLAM) | LiDAR+IMU 융합(IESKF)으로 **odometry/맵** 생성 |
| **SUPER** | 궤적 계획 | odometry+맵으로 **안전 고속 궤적** 생성 → PX4로 |

**도구 분담** — RViz: 점군/3D. QGroundControl: 비행 상태/파라미터 GUI. **RDash: 그래프 구조·Hz·값·플롯(FFT/XY/3D)·제어·녹화 — 터미널/SSH에서.**

---

## 학습 루프 (매 세션 공통)

모든 실습은 이 5단계 루프로 돈다. RDash 키가 각 단계에 대응된다.

1. **관찰** — 트리(`/` 검색)로 그래프 파악 → `c` 연결뷰, `t` TF로 구조 확인.
2. **측정** — Hz 스파크라인, 대역폭, `p` 플롯(time/FFT/XY/3D)으로 수치화.
3. **가설** — "진동 때문에 드리프트", "QoS 미스매치로 echo 안 됨" 등.
4. **실험** — `x`(kill/call/set), `r`(재시작), 파라미터 변경, 북마크(`1`-`9`) 실행.
5. **기록** — `R` 녹화(rosbag) + 아래 실험노트 템플릿 한 줄. `J`로 실행 작업 정리.

**실험노트 템플릿** (매 실험 1줄, `notes.md`에 누적):
```
날짜 | bag이름 | 스택/조건 | 관찰(Hz, FFT peak, 오차) | 결론/다음 액션
```

> 습관: 이상 현상은 **먼저 `R` 녹화**부터. 재현 가능해야 공부가 된다.

---

## 1. 선수 지식 (없으면 병행 학습)

- **Linux/CLI**: bash, tmux, 환경변수, `source`, `colcon build`, apt.
- **C++**(주) / Python(보조), CMake, ROS2 패키지 구조.
- **수학·좌표계**: 강체 변환, 회전행렬/쿼터니언, SO(3), **TF2**, REP-103/105,
  PX4 **NED/FRD** ↔ ROS **ENU/FLU** 변환(최대 함정 — Phase1에서 실측으로 체득).
- **제어**: PID, cascade(자세→각속도, 위치→속도), 비행 모드.
- **상태추정**: IMU 적분·바이어스, EKF/**ESKF/IESKF**(FAST-LIO 핵심).
- **계획/최적화**: occupancy/ESDF 맵, minimum-snap, 궤적 최적화, MPC 개념.

---

## Phase 0 — ROS2 기초 + RDash 친숙 (3–5일)

**개념**: node/topic/service/param/action, DDS, **QoS**(reliability/durability), TF2, launch, `ros2 bag`.

**실습**
1. `talker`/`listener`, `turtlesim` 기동. `ros2 topic list/echo/hz/info`, `ros2 node info` 로 CLI 감각.
2. **RDash로 같은 그래프 재관찰**: 트리 탐색 → `/turtle1/cmd_vel` 선택 → Hz·스파크라인·값. `c`로 pub/sub 확인.
3. `/turtle1/pose`에서 `p` → `x`,`y` space 다중선택 → `x`키 **XY 플롯**(거북이 궤적이 그대로 그려짐), `theta`는 time+FFT.
4. 서비스 제어 체험: `/reset` 선택 → `x` → 요청 `{}` 호출. `/spawn`은 **인자 있는 호출** 연습: `{x: 5.0, y: 5.0, name: 'turtle2'}`.
5. 북마크 만들기(`b`→`a`): "circle" = `ros2 topic pub -r 3 /turtle1/cmd_vel geometry_msgs/msg/Twist '{linear: {x: 1.0}, angular: {z: 0.7}}'` → `1`로 실행, `J`로 확인/종료.

**진단 훈련**: 일부러 `ros2 daemon stop` → RDash 트리가 비는 것 확인 → 북마크 "daemon 재시작"으로 복구.

**마일스톤**: turtlesim을 RDash만으로 관찰·조작(스폰 포함). **산출물**: 북마크 3개 + 첫 실험노트.

---

## Phase 1 — PX4 SITL + ROS2 브리지 (1–2주)

**개념**
- PX4 아키텍처: 모듈, **uORB**, 파라미터, 비행모드, **EKF2**, **offboard** 모드.
- ROS2 연결: **uXRCE-DDS**(`MicroXRCEAgent`) + `px4_msgs` + `px4_ros_com`.
- **offboard 조건**: `OffboardControlMode` + setpoint 을 **2Hz 이상 연속 스트림**해야 진입/유지. 안 지키면 거부/이탈.
- 좌표계: PX4 **NED/FRD** ↔ ROS **ENU/FLU** (px4_ros_com 변환 유틸 확인).

**실습**
1. `make px4_sitl gz_x500` (또는 Classic Gazebo) + QGroundControl.
2. `MicroXRCEAgent udp4 -p 8888` → `/fmu/out/*`, `/fmu/in/*` 생성 확인.
3. offboard 예제: **이륙 → 호버 → 원 궤적**. arm/disarm 을 `VehicleCommand`(command 400) 퍼블리시로도 해보기 → 북마크화.
4. `MPC_XY_VEL_MAX`, `MC_ROLLRATE_P` 등 파라미터 소폭 변경 → 응답 비교.

**예상 Hz 표 (SITL 기준 대략치 — RDash 스파크라인으로 직접 검증하고 표를 자기 값으로 채울 것)**

| 토픽 | 예상 Hz | 비고 |
|---|---|---|
| `/fmu/out/sensor_combined` | 200~250 | IMU 원시. FFT 대상 1순위 |
| `/fmu/out/vehicle_attitude` | 100~250 | 자세 쿼터니언 |
| `/fmu/out/vehicle_local_position` | 50~150 | EKF2 출력 |
| `/fmu/out/vehicle_odometry` | ~100 | 오도메트리 |
| `/fmu/out/vehicle_status` | 1~10 | 모드/암 상태 |
| `/fmu/in/trajectory_setpoint` | ≥2 (보통 20~50) | 내가 보내는 것 |

**RDash 실습(구체 절차)**
- **QoS 함정 체험**: `/fmu/out/*`는 **best-effort**. echo가 안 나오면 QoS 미스매치 의심(구버전 CLI). RDash 값 패널이 비면 `c`로 발행자 존재부터 확인하는 습관.
- **IMU 진동 분석**: `sensor_combined` → `p` → 가속도/자이로 z → **FFT**. 호버 중 peak 주파수 기록 → PX4 `IMU_GYRO_NF0_FRQ`(노치) / `IMU_GYRO_CUTOFF` 개념과 연결. (SITL은 진동이 작음 — 실기와 비교 포인트로 기록만.)
- **명령 vs 실제**: `trajectory_setpoint.position` 과 `vehicle_local_position.x/y` 를 각각 플롯 → 추종 지연/오버슈트 관찰. `+`/`-`로 렌더율 조절.
- **모드 감시**: `vehicle_status` 선택 + `space` 프리즈로 필드 정독(`Tab` 와이드모드로 넓게).
- **offboard 거부 재현**: setpoint 스트림을 `J`에서 kill → 모드 이탈 관찰 → "왜 2Hz 규칙이 있는가" 체득.

**함정**: ENU↔NED 부호(원 궤적이 **거울상**으로 돌면 100% 이것), 타임스탬프(`timestamp` µs), QoS, offboard 연속성.

**마일스톤**: offboard 원 궤적 + setpoint/실제 플롯 대조 + IMU FFT 기록. **산출물**: Hz 표 실측본, arm/disarm·agent 북마크, 원궤적 bag.

---

## Phase 2 — FAST-LIO (2–3주)

**이론**
- LIO = **IMU 예측 + LiDAR 보정**. **IESKF**, point-to-plane 잔차, **ikd-Tree** 증분 맵.
- **extrinsic**(LiDAR–IMU T/R)과 **시간동기**가 품질의 80%.

**실습**
1. **공개 rosbag 먼저**(센서 불필요): `fast_lio` 빌드 → bag 재생 → RViz로 맵 확인.
2. config 정독: `lid_topic`/`imu_topic`, `extrinsic_T/R`, `filter_size_surf/map`, IMU noise.
3. 시뮬 LiDAR(gz-sim x500에 LiDAR 부착 또는 제공 월드)로 실시간 매핑.

**예상 Hz 표**

| 토픽 | 예상 Hz | 비고 |
|---|---|---|
| LiDAR 원시(`/livox/lidar` 등) | 10 (Livox high-freq 시 50~100) | 대역폭 큼 |
| IMU(`/livox/imu` 등) | 200+ | |
| `/Odometry` | LiDAR rate와 동일 | 출력 |
| `/cloud_registered` | LiDAR rate | **대역폭만** 볼 것 |
| `/path` | 1~10 | |

**RDash 실습**
- **관측자 부하 관리**: 점군 토픽이 많으니 `h` → **selected** 로 전환(보이는 토픽만 Hz 측정). `/cloud_registered`는 값 echo 대신 **헤더의 Hz·대역폭**만 확인 — 렌더는 RViz.
- **드리프트 감시**: `/Odometry` → `p` → `pose.pose.position.x,y` **XY 플롯**: 정지 상태에서 점이 퍼지면 드리프트. `x,y,z` 3필드 → **3D 궤적**으로 비행 경로 확인.
- **TF 검증**: `t` — `camera_init`/`map` → `body`(→ `lidar`/`imu`) 체인이 config와 일치하는지. 프레임이 두 갈래로 갈라져 있으면 remap 문제.
- **진동→드리프트 인과**: IMU 토픽 FFT의 peak ↔ 드리프트 발생 조건 대조(실험노트에 페어로 기록).
- **파이프라인 확인**: `c`를 sensor→fast_lio→`/Odometry` 순으로. `S`로 fast_lio CPU(=filter_size 조정의 근거).
- 반복 실험은 북마크: "replay" = `ros2 bag play <bag> --clock`, "flio 재시작"은 노드 선택 후 `r`.

**튜닝 순서**: extrinsic 정확화 → 시간동기 → `filter_size`(정밀 vs CPU, `S`로 확인) → IMU noise.

**함정**: extrinsic 부호/행렬 순서, LiDAR-IMU 시간 오프셋, frame_id/remap, 초기화 시 정지 필요, bag 재생 시 `use_sim_time`.

**마일스톤**: bag→실시간 순으로 안정 odometry + TF 정상 + 드리프트 원인 1개 이상을 데이터로 설명. **산출물**: 드리프트 XY 플롯 스크린샷, 튜닝 전후 비교 노트, 매핑 bag.

---

## Phase 3 — SUPER planner (2–3주)

**이론**
- 안전-보장 **고속** 계획: LiDAR 점군/odometry 기반 지도, 궤적 표현(다항식/B-spline/MINCO 계열), 안전 코리도, 수평선(receding horizon).
- 입력: FAST-LIO **odometry** + 로컬 클라우드 + **goal**. 출력: **trajectory/position command** → PX4.

**실습**
1. SUPER 빌드 → config에서 **토픽 이름은 스택마다 다르다** — 외우지 말고 RDash `/` 검색으로 odom/cloud/goal/cmd 토픽을 **직접 발견**하는 것 자체가 훈련.
2. 제공 시뮬 환경에서 goal 발행(RViz Nav Goal 또는 토픽) → 궤적 생성.
3. FAST-LIO odometry 연결 → PX4 전달 전 단계까지.

**RDash 실습**
- **궤적 품질**: planner 출력 pos/vel/acc(있으면 jerk)를 time 플롯 오버레이 → 매끄러움 확인. **FFT로 고주파 성분**이 크면 나쁜 궤적(공진 여기 위험).
- **추종오차 분석**: (cmd − odom) 를 눈으로 대조(각각 플롯) → 오차가 커지는 **주파수/속도 구간** 식별 = 컨트롤러 대역폭 한계.
- **계획 부하**: `S`로 planner CPU — 속도 상한을 올릴수록 어떻게 변하나.
- **연결 검증**: `c`를 odom→planner→cmd 순으로. goal을 보냈는데 조용하면 여기서 90% 잡힘.
- 실패 시나리오는 반드시 `R` 녹화 → bag 재생으로 재현 분석.

**함정**: **프레임 불일치**(planner map ↔ LIO odom ↔ PX4 local — `t`로 삼자 대조), odom 지연/지터, 맵 갱신율, goal 프레임.

**마일스톤**: 장애물 환경 goal→goal 궤적 생성·추종 + 궤적 스펙트럼/추종오차 해석. **산출물**: 궤적 FFT 비교(저속 vs 고속), 실패 케이스 bag 1개 + 원인 노트.

---

## Phase 4 — 통합 & Gazebo 시나리오 (2주+)

**목표**: sensors → FAST-LIO → SUPER → PX4 → 시뮬 **폐루프**.

**통합 포인트 (순서대로)**
1. **FAST-LIO → PX4 EKF2 융합**: odometry를 `/fmu/in/vehicle_visual_odometry`로 (ENU→NED 변환 주의!). PX4 `EKF2_EV_*` 파라미터로 external vision 활성화. → GPS 없이 위치 유지 확인.
2. **SUPER → PX4**: planner cmd를 `TrajectorySetpoint`으로 변환·스트림(2Hz 규칙!).
3. 장애물 월드에서 goal 비행 → 속도 상한을 점진 상승.

**Gazebo 런타임 제어 (RDash에서)**
- Classic: `/gazebo/pause_physics`, `/gazebo/reset_world` → `x`로 즉시 호출, `spawn_entity`/`set_entity_state`는 **인자 있는 서비스 호출**로. 자주 쓰면 북마크.
- gz-sim: `gz service ...` CLI를 북마크로 등록해 `1`-`9` 실행.
- (모델/월드 SDF **편집**은 에디터/GUI 영역 — RDash 범위 밖.)

**RDash 실습**
- 전 파이프라인 한 화면: 트리에서 fmu/lio/planner Hz 동시 감시(`h` selected), `c`/`t`로 구조, `S`로 병목, 실험마다 `R`.
- **`F` 프리플라이트**로 비행 전 체크(센서 토픽·Hz, 노드 살아있음, 서비스). `w` 워치리스트로 핵심 값 몇 개 상시 감시. 트리 `⚠`(stale)로 죽은 센서 즉시 포착. 튜닝 비교는 `B`(A/B bag).
- 멀티 컨테이너 구성(px4 컨테이너 / lio 컨테이너 등)이면 `D` 도메인 전환으로 각각 확인.
- **회귀 실험**: 같은 코스를 파라미터만 바꿔 N회 → bag 비교. 평가지표: 도착 성공률, 평균/최고 속도, 정지 시 드리프트, 추종 RMS 오차, 충돌율.

**마일스톤**: GPS-less(EV 융합) 호버 → 통합 고속 goal 비행 성공. **산출물**: 파라미터 스윕 결과 표, 최종 데모 bag.

---

## 주차별 일정 (기준 9주)

| 주 | 내용 | 완료 기준 |
|---|---|---|
| 1 | Phase 0 + 선수지식 보강 | turtlesim RDash 조작 + 북마크 |
| 2 | PX4 SITL + 브리지 | `/fmu/out/*` Hz 표 실측 |
| 3 | offboard 비행 | 원 궤적 + setpoint/실제 플롯 |
| 4 | FAST-LIO bag 구동 | bag 기반 odometry + TF 검증 |
| 5 | FAST-LIO 실시간+튜닝 | 드리프트 진단 노트 |
| 6 | SUPER 단독 | goal→궤적 + 스펙트럼 해석 |
| 7 | SUPER+LIO | 추종오차 분석 |
| 8 | 통합(EV 융합, cmd 변환) | GPS-less 호버 |
| 9 | 시나리오+회귀 실험 | 고속 goal 비행 + 스윕 표 |

밀리면 Phase 2를 늘리고 4를 줄일 것(상태추정이 기반).

---

## 북마크 프리셋 (`~/.rdashrc` 예시 — Phase 진행하며 교체)

```json
{ "bookmarks": [
  { "name": "xrce agent",   "cmd": "MicroXRCEAgent udp4 -p 8888", "key": "1" },
  { "name": "daemon restart","cmd": "ros2 daemon stop && ros2 daemon start", "key": "2" },
  { "name": "arm",          "cmd": "ros2 topic pub -1 /fmu/in/vehicle_command px4_msgs/msg/VehicleCommand '{command: 400, param1: 1.0, target_system: 1, target_component: 1, source_system: 1, source_component: 1, from_external: true}'", "key": "3" },
  { "name": "disarm",       "cmd": "ros2 topic pub -1 /fmu/in/vehicle_command px4_msgs/msg/VehicleCommand '{command: 400, param1: 0.0, target_system: 1, target_component: 1, source_system: 1, source_component: 1, from_external: true}'", "key": "4" },
  { "name": "bag replay",   "cmd": "ros2 bag play latest --clock", "key": "5" },
  { "name": "gz pause",     "cmd": "rosservice call /gazebo/pause_physics", "key": "6" }
] }
```

장시간 도는 북마크(agent, pub -r, play)는 **`J`(Jobs)에서 출력 확인·종료**가 짝이다.

---

## 진단 플레이북 (막혔을 때 이 순서)

**A. "토픽이 안 보인다 / echo가 조용하다"**
1. 트리에 토픽 자체가 없나? → 노드 안 떴거나 도메인 다름(`D`, EnvBar `dom:` 확인).
2. 토픽은 있는데 Hz 0? → `c`로 **발행자 존재** 확인 → 없으면 상류 문제.
3. 발행자 있는데 값이 안 옴? → **QoS 미스매치**(best-effort) 의심.
4. ROS2 트리가 통째로 빈다 → `ros2 daemon stop && start` (북마크).

**B. "odometry가 드리프트한다"**
1. 정지 상태 XY 플롯으로 정량화 → 2. IMU FFT로 진동 peak → 3. `t`로 extrinsic/프레임 → 4. 시간동기 → 5. filter_size/noise 튜닝(변경당 bag 1개).

**C. "offboard가 거부/이탈된다"**
1. setpoint 스트림 Hz ≥2 인가(트리에서 `/fmu/in/*` Hz) → 2. `vehicle_status` 프리즈로 모드/사유 정독 → 3. arm 상태/사전조건(EKF OK?).

**D. "제어가 발진한다"**
1. rates setpoint vs 실제 각속도 플롯 → 2. **FFT로 발진 주파수** → 3. 해당 루프 게인/필터 (주파수가 프롭 하모닉이면 노치 문제, 저주파면 게인 과다).

**E. "planner가 조용하다"**
1. `c`: goal이 planner에 실제 도달? → 2. odom/cloud 입력 Hz 정상? → 3. `t`: goal 프레임 = planner 맵 프레임? → 4. `S`: CPU 100% 걸림?

---

## 마일스톤 체크리스트

- [ ] P0: turtlesim RDash 관찰·조작(+spawn 인자 호출)
- [ ] P1: `/fmu/out/*` Hz 표 실측
- [ ] P1: offboard 원 궤적 + setpoint/실제 플롯
- [ ] P1: sensor_combined FFT 기록
- [ ] P2: bag 기반 FAST-LIO odometry
- [ ] P2: 실시간 FAST-LIO + TF 정상 + 드리프트 진단 노트
- [ ] P3: goal→trajectory 생성
- [ ] P3: 궤적 스펙트럼/추종오차 해석
- [ ] P4: EV 융합 GPS-less 호버
- [ ] P4: 통합 고속 비행 + 회귀 실험 표

---

## RDash 학습 치트시트

| 궁금한 것 | RDash |
|---|---|
| 이 토픽 얼마나 자주 나와? | 트리 Hz + 스파크라인, `h` 측정모드(all/selected/off) |
| 값이 지금 뭐임? | `Enter` → 값 패널, `space` 프리즈, `Tab` 와이드 |
| IMU 진동/제어 발진 주파수 | `p` → 필드 → FFT |
| 위치 궤적 모양 | `p` → x,y(,z) → `x` (XY/3D) |
| 두 값 상관관계 | `p` → 2필드 → `x` (XY+선형회귀 R²) |
| 누가 발행/구독? | `c` 연결뷰 |
| 좌표 프레임 관계 | `t` TF 트리 |
| 두 프레임 실제 변환/거리 | `T` tf echo(source→target) |
| 센서 죽었나/지연? | 트리 빨간 `⚠`(stale), 값 헤더 `lat/age` |
| 여러 값 동시에 | `w` 워치리스트(필드 핀) |
| 비행 전 스택 준비됐나 | `F` 프리플라이트(✓/✗) |
| 두 실험(bag) 내용 비교 | `B` A/B bag 비교 |
| 어느 노드가 CPU 먹어? | `S` 리소스 |
| 서비스 호출(인자 포함) | `x` → 요청 YAML 입력 (Gazebo spawn 등) |
| 노드 재시작/킬 | `r` / `x` |
| 실험 기록/재생 | `R` 녹화 / `P` 재생 |
| 긴 명령 반복 실행 | `b` 북마크, `1`-`9` |
| 띄운 프로세스 확인/종료 | `J` Jobs |
| 다른 컨테이너 그래프 | `D` 도메인 전환 (EnvBar 확인) |
| 키 까먹음 | `?` |

---

## 참고 자료 (버전은 공식 문서 확인)

- **ROS2**: docs.ros.org — TF2, QoS, rosbag2.
- **PX4**: docs.px4.io — ROS2(uXRCE-DDS), offboard, SITL(gz), EKF2 external vision(`EKF2_EV_*`), 진동/필터링(노치), 좌표계.
- **px4_msgs / px4_ros_com**: PX4 GitHub.
- **FAST-LIO**: HKUST-Aerial-Robotics/FAST_LIO — 논문(FAST-LIO2) + config.
- **SUPER**: HKUST-Aerial-Robotics/SUPER — 논문 + config.
- **좌표 규약**: REP-103, REP-105.

> 마지막 팁: 막히면 항상 `c`(연결) → `t`(프레임) → Hz(스파크라인) 순서. "안 연결됨 / 프레임 꼬임 / 죽어있음"이 문제의 대부분이고, 셋 다 RDash 한 화면에서 10초 안에 확인된다.
