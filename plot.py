#!/usr/bin/env python3
"""RDash 라이브 플롯 — stdin 으로 들어오는 ROS echo(YAML) 스트림에서 지정 필드를 추출해
matplotlib 로 실시간 표시한다.

모드:
  time (기본) — 시간축 그래프.
    · 필드 1개 : 원값 / n차 미분·적분(↑↓) / FFT 스펙트럼  (3단)
    · 필드 N개 : 원값 오버레이 / n차 미분·적분 오버레이   (2단, 예: pose x,y,z)
  xy         — 필드 2개를 X·Y 축으로 산점도 + 선형회귀(y=ax+b, R²). 예: pose.x vs pose.y,
               두 값의 상관관계.

RDash(index.js)가  `ros2 topic echo <topic>` | python3 plot.py --field a --field b [--mode xy]
형태로 파이프해 실행한다. ROS1/ROS2 공통. numpy·matplotlib 필요."""
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

ORDER_MIN, ORDER_MAX = -6, 6


def parse_args():
    ap = argparse.ArgumentParser(description="RDash live matplotlib plotter")
    ap.add_argument("--field", action="append", required=True,
                    help="점(.) 필드 경로. 여러 번 지정 가능 (예: --field position.x --field position.y)")
    ap.add_argument("--mode", choices=("time", "xy", "xyz"), default="time")
    ap.add_argument("--title", default="")
    ap.add_argument("--window", type=int, default=512, help="유지할 최근 샘플 수")
    ap.add_argument("--interval", type=int, default=100, help="렌더 주기(ms)")
    ap.add_argument("--order", type=int, default=1, help="time 모드 변환 차수: +미분 / -적분 / 0 원값")
    ap.add_argument("--save", default="", help="지정 시 GUI 대신 한 프레임 PNG 저장(헤드리스/데모)")
    return ap.parse_args()


def extract(doc, path):
    """중첩 dict/list 에서 점 경로로 값 하나를 꺼낸다."""
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


def integrate(y, t):
    """누적 사다리꼴 적분 — ∫y dt."""
    out = np.zeros_like(y)
    if y.size > 1:
        out[1:] = np.cumsum((y[1:] + y[:-1]) / 2.0 * np.diff(t))
    return out


def apply_order(v, t, k):
    """k>0: k차 미분, k<0: |k|차 적분, k==0: 원값. (배열, 라벨) 반환."""
    if k == 0:
        return v, "value"
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


def linfit(x, y):
    """선형회귀 y=ax+b 와 결정계수 R². 유효 표본 2개 미만이면 None."""
    mask = ~(np.isnan(x) | np.isnan(y))
    x, y = x[mask], y[mask]
    if x.size < 2 or np.ptp(x) == 0:
        return None
    a, b = np.polyfit(x, y, 1)
    yhat = a * x + b
    ss_res = float(np.sum((y - yhat) ** 2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 1.0
    return a, b, r2, x, y


def main():
    args = parse_args()
    fields = args.field
    paths = [f.split(".") for f in fields]
    need = {"xy": 2, "xyz": 3}.get(args.mode)
    if need and len(fields) != need:
        sys.stderr.write(f"plot.py: --mode {args.mode} 는 --field {need}개 필요\n")
        sys.exit(2)

    buf_t = collections.deque(maxlen=args.window)
    buf = {f: collections.deque(maxlen=args.window) for f in fields}
    lock = threading.Lock()
    t0 = time.monotonic()

    def record(text):
        if not text.strip():
            return
        doc = None
        if yaml is not None:
            try:
                doc = yaml.safe_load(text)
            except Exception:
                doc = None
        vals = {}
        for f, p in zip(fields, paths):
            v = extract(doc, p) if isinstance(doc, (dict, list)) else None
            if v is None and len(fields) == 1:
                try:
                    v = float(text.strip())      # 스칼라 echo 폴백(단일 필드)
                except Exception:
                    v = None
            try:
                vals[f] = float(v)
            except (TypeError, ValueError):
                vals[f] = float("nan")
        with lock:
            buf_t.append(time.monotonic() - t0)
            for f in fields:
                buf[f].append(vals[f])

    def reader():
        block = []
        for line in sys.stdin:
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
    single = (args.mode == "time" and len(fields) == 1)

    def snapshot():
        with lock:
            t = np.array(buf_t, dtype=float)
            cols = {f: np.array(buf[f], dtype=float) for f in fields}
        return t, cols

    if args.mode == "xy":
        # 파라메트릭/공간 플롯: y vs x. 궤적선(시간순) + 산점 + 선형회귀(토글 'f').
        # 종횡비를 1:1 로 고정 → 원 궤적이 원으로 보임(찌그러짐 방지).
        state["fit"] = True
        fig, ax = plt.subplots(figsize=(7.5, 7.5))
        (ln_path,) = ax.plot([], [], color="tab:blue", lw=0.8, alpha=0.6)   # 궤적(시간순 연결)
        sc = ax.scatter([], [], s=8, alpha=0.5)
        (ln_fit,) = ax.plot([], [], color="tab:red", lw=1.5)
        ax.set_xlabel(fields[0]); ax.set_ylabel(fields[1]); ax.grid(True, alpha=0.3)
        ax.set_aspect("equal", adjustable="datalim")
        fig.text(0.5, 0.005, "f: toggle linear-regression line", ha="center", va="bottom",
                 fontsize=8, color="gray")
        fig.canvas.mpl_connect("key_press_event",
                               lambda ev: state.update(fit=not state["fit"]) if ev.key == "f" else None)

        def update(_):
            t, cols = snapshot()
            x, y = cols[fields[0]], cols[fields[1]]
            if x.size < 2:
                return sc, ln_fit, ln_path
            ln_path.set_data(x, y)
            sc.set_offsets(np.column_stack([x, y]))
            ttl = f"{fields[1]} vs {fields[0]}"
            fit = linfit(x, y) if state["fit"] else None
            if fit:
                a, b, r2, xf, _ = fit
                xs = np.linspace(np.nanmin(xf), np.nanmax(xf), 2)
                ln_fit.set_data(xs, a * xs + b)
                ttl += f"    y = {a:.3g}·x + {b:.3g}    R² = {r2:.3f}"
            else:
                ln_fit.set_data([], [])
            ax.set_title(ttl, fontsize=10)
            ax.relim(); ax.autoscale_view()
            return sc, ln_fit, ln_path
    elif args.mode == "xyz":
        # 3D 궤적: pose x,y,z 를 공간에 그림(예: 원기둥/나선 궤적).
        from mpl_toolkits.mplot3d import Axes3D  # noqa: F401 (projection='3d' 등록용)
        fig = plt.figure(figsize=(8, 7.5))
        ax = fig.add_subplot(111, projection="3d")
        (ln3,) = ax.plot([], [], [], color="tab:blue", lw=1.0)
        (pt3,) = ax.plot([], [], [], "o", color="tab:red", ms=5)   # 현재 위치
        ax.set_xlabel(fields[0]); ax.set_ylabel(fields[1]); ax.set_zlabel(fields[2])

        def update(_):
            t, cols = snapshot()
            x, y, z = cols[fields[0]], cols[fields[1]], cols[fields[2]]
            m = ~(np.isnan(x) | np.isnan(y) | np.isnan(z))
            x, y, z = x[m], y[m], z[m]
            if x.size < 2:
                return ln3, pt3
            ln3.set_data(x, y); ln3.set_3d_properties(z)
            pt3.set_data(x[-1:], y[-1:]); pt3.set_3d_properties(z[-1:])
            ax.set_xlim(np.min(x), np.max(x) + 1e-9)
            ax.set_ylim(np.min(y), np.max(y) + 1e-9)
            ax.set_zlim(np.min(z), np.max(z) + 1e-9)
            return ln3, pt3
    else:
        n_ax = 3 if single else 2
        fig, axes = plt.subplots(n_ax, 1, figsize=(8, 7.5))
        ax_r, ax_d = axes[0], axes[1]
        ax_f = axes[2] if single else None
        lines_r = {f: ax_r.plot([], [], lw=1.2, label=f)[0] for f in fields}
        lines_d = {f: ax_d.plot([], [], lw=1.2, label=f)[0] for f in fields}
        ax_r.set_ylabel("value")
        if not single:
            ax_r.legend(fontsize=7, loc="upper right"); ax_d.legend(fontsize=7, loc="upper right")
        if ax_f is not None:
            (ln_f,) = ax_f.plot([], [], lw=1.2, color="tab:green")
            ax_f.set_ylabel("|FFT|"); ax_f.set_xlabel("frequency [Hz]")
        for ax in axes:
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
            t, cols = snapshot()
            if t.size < 2:
                return []
            label = "value"
            for f in fields:
                v = cols[f]
                lines_r[f].set_data(t, v)
                yv, label = apply_order(v, t, state["order"])
                lines_d[f].set_data(t, yv)
            ax_d.set_ylabel(label)
            ax_r.relim(); ax_r.autoscale_view(); ax_d.relim(); ax_d.autoscale_view()
            if ax_f is not None and t.size >= 8:
                v = cols[fields[0]]
                dt = (t[-1] - t[0]) / (t.size - 1)
                if dt > 0:
                    vu = np.interp(np.linspace(t[0], t[-1], t.size), t, v)
                    vu = vu - np.nanmean(vu)
                    spec = np.abs(np.fft.rfft(np.nan_to_num(vu) * np.hanning(vu.size)))
                    ln_f.set_data(np.fft.rfftfreq(vu.size, d=dt), spec)
                    ax_f.relim(); ax_f.autoscale_view()
            return []

    fig.suptitle(args.title or (", ".join(fields)))
    fig.tight_layout(rect=(0, 0.03, 1, 0.96))

    if args.save:
        deadline = time.time() + 12
        while time.time() < deadline:
            with lock:
                enough = len(buf_t) >= min(args.window, 64)
            if enough:
                break
            time.sleep(0.05)
        update(None)
        fig.savefig(args.save, dpi=120)
        return

    _ani = FuncAnimation(fig, update, interval=args.interval, cache_frame_data=False)
    fig._rdash_ani = _ani
    plt.show()


if __name__ == "__main__":
    main()
