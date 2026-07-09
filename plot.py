#!/usr/bin/env python3
"""RDash 라이브 플롯 — stdin 으로 들어오는 ROS echo(YAML) 스트림에서 지정 필드 하나를
추출해 matplotlib 로 실시간 표시한다. 3단 그래프:
  1) 원값(value)         : 필드 값 자체
  2) 미분(d/dt)          : 수치 미분 — 예) 속도 → 가속도
  3) FFT 스펙트럼(|X(f)|) : 최근 윈도우를 Hann 윈도잉 후 주파수 성분 분해

RDash(index.js)가  `ros2 topic echo <topic>` | python3 plot.py --field a.b.c  형태로
파이프해 실행한다. ROS1/ROS2 공통(둘 다 기본 출력이 YAML). 필드가 스칼라 echo(숫자만)
로 들어와도 폴백 파싱한다.  numpy·matplotlib 필요."""
import argparse
import collections
import sys
import threading
import time

try:
    import numpy as np
except Exception:
    sys.stderr.write("plot.py: numpy 필요 —  pip install numpy matplotlib\n")
    sys.exit(2)
try:
    import matplotlib.pyplot as plt
    from matplotlib.animation import FuncAnimation
except Exception:
    sys.stderr.write("plot.py: matplotlib 필요 —  pip install numpy matplotlib\n")
    sys.exit(2)

try:
    import yaml
except Exception:
    yaml = None


def parse_args():
    ap = argparse.ArgumentParser(description="RDash live matplotlib plotter (raw / n-th d-dt·integral / FFT)")
    ap.add_argument("--field", required=True, help="점(.)으로 구분된 필드 경로 (예: orientation.x)")
    ap.add_argument("--title", default="", help="창 제목")
    ap.add_argument("--window", type=int, default=512, help="유지할 최근 샘플 수")
    ap.add_argument("--interval", type=int, default=100, help="렌더 주기(ms)")
    ap.add_argument("--order", type=int, default=1, help="변환 차수: 양수=미분, 음수=적분, 0=원값")
    ap.add_argument("--save", default="", help="지정 시 GUI 대신 한 프레임을 이 경로에 PNG 로 저장(헤드리스/데모)")
    return ap.parse_args()


ORDER_MIN, ORDER_MAX = -6, 6


def integrate(y, t):
    """누적 사다리꼴 적분 — ∫y dt."""
    out = np.zeros_like(y)
    if y.size > 1:
        out[1:] = np.cumsum((y[1:] + y[:-1]) / 2.0 * np.diff(t))
    return out


def apply_order(v, t, k):
    """k>0: k차 미분(반복 gradient), k<0: |k|차 적분, k==0: 원값. (배열, 라벨) 반환."""
    if k == 0:
        return v.copy(), "value"
    if k > 0:
        y = v
        for _ in range(k):
            y = np.gradient(y, t)
        return y, ("d/dt" if k == 1 else f"d^{k}/dt^{k}")
    m = -k
    y = v
    for _ in range(m):
        y = integrate(y, t)
    return y, ("∫ dt" if m == 1 else "∫" * m + f" (order {m})")


def extract(doc, path):
    """중첩 dict/list 에서 점 경로로 값 하나를 꺼낸다. 리스트 인덱스는 정수 키 허용."""
    cur = doc
    for k in path:
        if isinstance(cur, dict) and k in cur:
            cur = cur[k]
        elif isinstance(cur, (list, tuple)) and k.lstrip("-").isdigit():
            i = int(k)
            if -len(cur) <= i < len(cur):
                cur = cur[i]
            else:
                return None
        else:
            return None
    return cur


def main():
    args = parse_args()
    path = args.field.split(".")
    buf_t = collections.deque(maxlen=args.window)
    buf_v = collections.deque(maxlen=args.window)
    lock = threading.Lock()
    t0 = time.monotonic()

    def record(text):
        if not text.strip():
            return
        val = None
        if yaml is not None:
            try:
                val = extract(yaml.safe_load(text), path)
            except Exception:
                val = None
        if val is None:                      # 필드 echo(숫자만) 폴백
            try:
                val = float(text.strip())
            except Exception:
                return
        try:
            v = float(val)
        except (TypeError, ValueError):
            return
        with lock:
            buf_t.append(time.monotonic() - t0)
            buf_v.append(v)

    def reader():
        block = []
        for line in sys.stdin:                # 메시지 경계 '---' 로 YAML 블록 분리
            line = line.rstrip("\n")
            if line.strip() == "---":
                record("\n".join(block))
                block = []
            else:
                block.append(line)
        if block:
            record("\n".join(block))

    threading.Thread(target=reader, daemon=True).start()

    state = {"order": int(np.clip(args.order, ORDER_MIN, ORDER_MAX))}

    fig, (ax_r, ax_d, ax_f) = plt.subplots(3, 1, figsize=(8, 7.5))
    fig.suptitle(args.title or args.field)
    ln_r, = ax_r.plot([], [], lw=1.2)
    ln_d, = ax_d.plot([], [], lw=1.2, color="tab:orange")
    ln_f, = ax_f.plot([], [], lw=1.2, color="tab:green")
    ax_r.set_ylabel("value")
    ax_f.set_ylabel("|FFT|")
    ax_f.set_xlabel("frequency [Hz]")
    for ax in (ax_r, ax_d, ax_f):
        ax.grid(True, alpha=0.3)
    fig.text(0.5, 0.005,
             "up/down: order  (+ = derivative, - = integral)   0: raw   |   n-th order supported",
             ha="center", va="bottom", fontsize=8, color="gray")

    def on_key(ev):
        if ev.key in ("up", "+", "="):
            state["order"] = min(ORDER_MAX, state["order"] + 1)
        elif ev.key in ("down", "-"):
            state["order"] = max(ORDER_MIN, state["order"] - 1)
        elif ev.key == "0":
            state["order"] = 0

    fig.canvas.mpl_connect("key_press_event", on_key)

    def update(_):
        with lock:
            t = np.array(buf_t, dtype=float)
            v = np.array(buf_v, dtype=float)
        if t.size < 2:
            return ln_r, ln_d, ln_f
        ln_r.set_data(t, v)
        ax_r.relim(); ax_r.autoscale_view()
        # n차 미분/적분 — order 로 조절
        yv, label = apply_order(v, t, state["order"])
        ln_d.set_data(t, yv)
        ax_d.set_ylabel(label)
        ax_d.relim(); ax_d.autoscale_view()
        # FFT — 불균일 샘플을 균일 격자로 리샘플 후 Hann 윈도잉, DC 제거
        if t.size >= 8:
            dt = (t[-1] - t[0]) / (t.size - 1)
            if dt > 0:
                tu = np.linspace(t[0], t[-1], t.size)
                vu = np.interp(tu, t, v)
                vu = vu - vu.mean()
                spec = np.abs(np.fft.rfft(vu * np.hanning(vu.size)))
                freq = np.fft.rfftfreq(vu.size, d=dt)
                ln_f.set_data(freq, spec)
                ax_f.relim(); ax_f.autoscale_view()
        return ln_r, ln_d, ln_f

    fig.tight_layout(rect=(0, 0.03, 1, 0.97))

    if args.save:                       # 헤드리스 스냅샷: 입력이 찰 때까지 잠깐 기다렸다 한 프레임 저장
        deadline = time.time() + 10
        while time.time() < deadline:
            with lock:
                enough = len(buf_v) >= args.window
            if enough:
                break
            time.sleep(0.05)
        update(None)
        fig.savefig(args.save, dpi=120)
        return

    # 참조 유지(FuncAnimation 이 GC 되면 애니메이션 멈춤)
    _ani = FuncAnimation(fig, update, interval=args.interval, cache_frame_data=False)
    fig._rdash_ani = _ani
    plt.show()


if __name__ == "__main__":
    main()
