# PX4 + FAST-LIO + SUPER 학습 플랜 (with RDash)

> 목표: **LiDAR 기반 자율 고속 드론 내비게이션 스택**을 이해하고 시뮬레이션에서 끝까지 돌려보기.
> 학습 도구로 **RDash**(이 저장소의 TUI)를 각 단계에서 적극 활용한다.

## 0. 큰 그림 — 데이터가 어떻게 흐르나

```
 LiDAR + IMU ──▶ FAST-LIO ──▶ odometry(위치/자세) ─┐
                    │                                ├─▶ SUPER planner ──▶ trajectory setpoint ──▶ PX4 ──▶ 모터/시뮬
                    └─▶ registered cloud / local map ┘        (goal 입력)         (pos/vel/acc/jerk)   (자세·위치 제어)
```

| 컴포넌트 | 역할 | 한 줄 |
|---|---|---|
| **PX4** | 오토파일럿 | 자세/위치 **제어**(cascade PID + EKF2), SITL 시뮬, offboard 입력 수신 |
| **FAST-LIO** | 상태추정(SLAM) | LiDAR+IMU 융합(IESKF)으로 **odometry/맵** 생성 |
| **SUPER** | 궤적 계획 | odometry+맵으로 **안전 고속 궤적** 생성 → PX4로 |

각 단계에서 "무엇을 RDash로 볼지"를 함께 적어둔다. RDash 키: `Enter` 펼침, `p` 플롯, `c` 연결뷰, `t` TF, `S` 리소스, `R` 녹화, `h` Hz모드, `D` 도메인, `?` 도움말.

---

## 1. 선수 지식 (없으면 병행 학습)

- **Linux/CLI**: bash, tmux, 환경변수, `source`, `colcon build`, apt.
- **C++**(주) / Python(보조), CMake, ROS2 패키지 구조.
- **수학·좌표계**: 강체 변환, 회전행렬/쿼터니언, SO(3), **TF2**, 좌표 규약
  - REP-103/105, PX4의 **NED/FRD** ↔ ROS의 **ENU/FLU** 변환(제일 흔한 함정).
- **제어**: PID, cascade(자세→각속도, 위치→속도), 비행 모드.
- **상태추정**: IMU 적분, EKF/**ESKF/IESKF**(FAST-LIO 핵심).
- **계획/최적화**: occupancy/ESDF 맵, minimum-snap, 궤적 최적화, MPC 개념.

---

## Phase 0 — ROS2 기초 + RDash 친숙 (3–5일)

**개념**: node/topic/service/param/action, DDS, **QoS**(reliability/durability), **TF2**, 실행(launch), `ros2 bag`.

**실습**
1. `ros2 run demo_nodes_cpp talker` / `listener`, `ros2 run turtlesim turtlesim_node`.
2. `ros2 topic list/echo/hz/info`, `ros2 node info`, `ros2 param list`, `rqt`.
3. **RDash**로 같은 그래프 관찰: 트리 탐색, `/turtle1/cmd_vel` echo·Hz·스파크라인, `c`로 pub/sub, `/`로 검색.
4. `/turtle1/pose`의 `x`,`y`를 `p`→space로 다중선택→XY 플롯(원 궤적), `theta`는 time+FFT.

**마일스톤**: turtlesim을 RDash만으로 관찰·이해하고, cmd_vel을 bookmark(`b`)로 발행.

---

## Phase 1 — PX4 SITL + ROS2 브리지 (1–2주)

**개념**
- PX4 아키텍처: 모듈, **uORB** 메시지, 파라미터, 비행모드, **EKF2**(내부 추정), **offboard** 모드.
- ROS2 연결: **uXRCE-DDS**(micro-XRCE-DDS Agent) + `px4_msgs` + `px4_ros_com`. (구형은 MAVROS.)
- 좌표계: PX4 내부 **NED/FRD** ↔ ROS **ENU/FLU**.

**실습**
1. PX4 SITL 기동: `make px4_sitl gz_x500`(gz-sim) 또는 Classic. QGroundControl 연결.
2. `MicroXRCEAgent udp4 -p 8888` 실행 → `/fmu/out/*`, `/fmu/in/*` 토픽 확인.
3. `px4_ros_com` offboard 예제로 **이륙→호버→원 궤적**.
4. 파라미터 몇 개 조정(예: `MPC_*`, `MC_*`) 후 응답 관찰.

**RDash로 볼 것**
- `/fmu/out/vehicle_local_position`, `vehicle_attitude`, `vehicle_odometry`, `sensor_combined` — Hz·값.
- `sensor_combined`(가속도/자이로) → `p` **FFT**로 IMU 진동 peak 확인(모터/프롭 하모닉 → 노치필터 후보).
- `/fmu/in/trajectory_setpoint`(명령) vs `vehicle_local_position`(실제) → 다중필드 time 플롯으로 추종 비교.
- `t` TF로 좌표 프레임, `c`로 브리지 노드 연결.

**함정**: ENU↔NED/FRD↔FLU 부호, 타임스탬프 동기, uXRCE **QoS(BEST_EFFORT)** 미스매치, offboard 진입 조건(연속 setpoint 필요).

**마일스톤**: offboard로 안정적 원 궤적 비행 + RDash로 setpoint/실제 플롯 대조.

---

## Phase 2 — FAST-LIO (2–3주)

**이론**
- LIO = **IMU로 예측 + LiDAR로 보정**. **IESKF**(iterated error-state KF), point-to-plane 잔차, **ikd-Tree** 증분 맵.
- 센서: LiDAR(Livox/기계식), IMU, **extrinsic(LiDAR–IMU 자세/위치)**, **시간동기**.

**실습**
1. 먼저 **공개 rosbag**으로 구동(센서 없이 원리 파악). `fast_lio` 빌드·실행.
2. config 이해: `lid_topic`, `imu_topic`, `extrinsic_T/R`, `filter_size_*`, IMU noise.
3. 시뮬/실기 LiDAR로 실시간 매핑, RViz로 점군·경로 확인(점군은 RViz가 정답).

**RDash로 볼 것**
- `/Odometry` — Hz·값(위치/자세 드리프트 감시), `p`로 위치 XY/3D 궤적, 속도 성분 time+FFT.
- `t` **TF 트리**: `map`/`camera_init`→`odom`→`body`/`lidar`/`imu` 프레임 관계가 맞는지.
- **IMU FFT**(`sensor`/imu 토픽): 진동 주파수 → LIO 드리프트 원인(진동 aliasing) 진단, 기구 댐핑/필터 결정.
- `/cloud_registered`는 RDash에선 **Hz·대역폭만**(점군 렌더는 RViz). `h`로 selected 측정해 관측자 부하↓.
- `c` 연결뷰로 sensor→fast_lio→odom 파이프라인, `S`로 fast_lio CPU/RSS.

**튜닝 포인트**: extrinsic 정확도, `filter_size`(정밀도 vs 부하), IMU noise, **진동 대응**(FFT로 찾은 주파수).

**함정**: extrinsic 부호/순서, LiDAR-IMU 시간동기, frame_id 정의, 초기화 시 정지 필요.

**마일스톤**: rosbag→실시간 순으로 안정적 odometry, TF 정상, 드리프트 원인을 FFT로 설명 가능.

---

## Phase 3 — SUPER planner (2–3주)

**이론**
- 안전-보장 **고속** 계획: LiDAR/odometry 기반 지도(occupancy/ESDF), 궤적 표현(다항식/B-spline), 최적화, 동적 안전.
- 입력: FAST-LIO **odometry** + 로컬 맵/클라우드 + **goal**. 출력: **trajectory setpoint** → PX4.

**실습**
1. `SUPER` 빌드·config(맵/센서/odometry 토픽명, 좌표 프레임).
2. goal 발행(RViz `2D Nav Goal`/토픽) → 궤적 생성 관찰.
3. FAST-LIO odometry와 결합, 그 다음 PX4로 궤적 전달까지 연결.

**RDash로 볼 것**
- goal / trajectory 토픽 값·Hz, `p`로 **pos/vel/acc/jerk** time 플롯(궤적 매끄러움 = 고주파 최소).
- **추종오차 FFT**: 컨트롤러 대역폭 한계·**기체 공진과 겹치는 궤적 주파수** 탐지(고속에서 핵심).
- `c` 연결뷰: odom→planner→control 흐름, `S`로 planner CPU(고속일수록 계획 부하).
- 시나리오 `R` 녹화 → 실패 케이스 오프라인 분석.

**함정**: **좌표 프레임 일치**(planner map ↔ LIO odom ↔ PX4), 지연/지터, 맵 갱신율, 궤적↔기체 공진.

**마일스톤**: 장애물 환경에서 goal→goal 궤적 생성·추종, 추종오차/궤적 스펙트럼 해석.

---

## Phase 4 — 통합 & Gazebo 시나리오 (2주+)

**목표**: sensors → FAST-LIO → SUPER → PX4 → 시뮬 **폐루프**를 하나로.

**실습**
1. Gazebo world에 장애물 배치, x500+LiDAR 모델로 고속 비행 시나리오.
2. 파라미터 스윕(속도 상한, filter, planner gains) → 성공률/속도/드리프트 비교.
3. RDash 한 화면에서 전 파이프라인 감시.

**RDash로 볼 것**
- 전체 Hz/연결(`c`)/TF(`t`) 한눈에, 병목 노드 `S` 리소스, 실험별 `R` 녹화→분석, 멀티 컨테이너면 `D` 도메인 전환.
- 시뮬 런타임 제어(pause/reset/spawn)는 **bookmark(`b`)** 로 (아래 Gazebo 섹션).

**평가지표**: 도착 성공률, 평균/최고 속도, odometry 드리프트, 충돌율.

---

## 마일스톤 체크리스트

- [ ] Phase0: turtlesim 그래프를 RDash로 관찰·조작
- [ ] Phase1: PX4 SITL offboard 원 궤적 + setpoint/실제 플롯
- [ ] Phase1: sensor_combined FFT로 IMU 진동 식별
- [ ] Phase2: rosbag으로 FAST-LIO odometry
- [ ] Phase2: 실시간 FAST-LIO + TF 정상 + 드리프트 FFT 진단
- [ ] Phase3: SUPER 단독 궤적 생성(goal→trajectory)
- [ ] Phase3: 추종오차/궤적 스펙트럼 해석
- [ ] Phase4: 통합 고속 비행 시나리오 성공

---

## RDash 학습 치트시트

| 궁금한 것 | RDash |
|---|---|
| 이 토픽 얼마나 자주 나와? | 트리 Hz + 스파크라인, `h`로 측정모드 |
| 값이 지금 뭐임? | `Enter` 선택 → 값 패널, `space` 프리즈 |
| IMU 진동/제어 발진 주파수 | `p` → 필드 선택 → FFT |
| 위치 궤적 모양 | `p` → x,y(또는 x,y,z) → `x`(XY/3D) |
| 두 값 상관관계 | `p` → 2필드 → `x`(XY + 선형회귀) |
| 누가 발행/구독? | `c` 연결뷰 |
| 좌표 프레임 관계 | `t` TF 트리 |
| 어느 노드가 CPU 먹어? | `S` 리소스 |
| 실험 기록 | `R` 녹화 → 나중에 분석 |
| 다른 컨테이너 그래프 | `D` 도메인 전환 |
| 자주 쓰는 명령 | `b`/`1`-`9` 북마크 |

---

## 참고 자료 (버전은 공식 문서 확인)

- **ROS2**: docs.ros.org (Humble/Jazzy), TF2 튜토리얼, QoS 가이드.
- **PX4**: docs.px4.io — ROS2(uXRCE-DDS), offboard, SITL(gz), 좌표계(NED/ENU).
- **px4_msgs / px4_ros_com**: PX4 GitHub.
- **FAST-LIO**: HKUST-Aerial-Robotics/FAST_LIO (논문·config).
- **SUPER**: HKUST-Aerial-Robotics/SUPER (논문·config).
- **좌표 규약**: REP-103, REP-105.

> 팁: 각 Phase를 **rosbag으로 먼저** 재현(`R` 녹화 습관) → 실시간 → 통합 순으로. 막히면 RDash `c`(연결)와 `t`(TF)부터 확인하면 "안 연결됨/프레임 꼬임"의 절반이 잡힌다.
