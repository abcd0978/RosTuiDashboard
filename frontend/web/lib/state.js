/* 공유 가변 상태 — items/ver/sel/selItem/marked/hideAnon 은 여러 모듈에서 재할당되므로
   단일 `state` 객체의 프로퍼티로 노출한다(모듈은 항상 state.xxx 로 읽고 쓴다).
   + byName/topics/visible/isAnon/nodeName 접근자. */

export const state = {
  items: [],
  ver: '?',
  sel: null,
  selItem: null,
  marked: new Set(),
  hideAnon: true,   // 트리뷰어: CLI/도구 익명 노드·서비스·토픽(ros_tui*, rostopic_* 등) 숨김(기본)
};

export function nodeName(e) {
  return Array.isArray(e) ? e[0] : e;
}

export function byName(n) {
  return state.items.find((i) => i.name === n);
}

export function topics() {
  return state.items.filter((i) => i.kind === 'topic');
}

// CLI/도구가 만드는 익명 헬퍼 노드/서비스 — rostopic/rosservice/rosparam/rosnode/ros2cli/rqt,
// RDash 텔레메트리(ros_tui), rosbridge/rosapi, launch가 만든 docker_desktop pid suffix 노드.
// echo·publish·hz·teleop·rosbridge 등을 돌릴 때 생겨서 그래프를 어지럽힌다 → 기본 숨김.
export function isAnon(n) {
  const s = String(n || '');
  const base = s.split('/').filter(Boolean)[0] || '';
  return /^\/(ros_tui|rostopic|rosservice|rosparam|rosnode|rosbag|roslaunch|_?ros2cli|rosbridge_websocket|rosapi|rqt)(?:_|\/|$)/.test(s)
    || /_(?:desktop|docker_desktop|[A-Za-z0-9-]+)_\d{3,}(?:_[A-Za-z0-9]+)?$/.test(base);
}

export function visible() {
  return state.items.filter((i) => !(i.name || '').includes('/_action/') && (!state.hideAnon || !isAnon(i.name)));
}
