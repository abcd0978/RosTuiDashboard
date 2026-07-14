/* 뷰들 — 각 views/*.js 를 모아 원래 app.js 의 `const Views = {...}` 를 재구성한다.
   (msgForm/streamView 는 `this` 제거로 plain 함수가 되어 더 이상 Views 의 프로퍼티가 아니다.) */

import { msgdef, qos, connections, tftree, setparam, params, lifecycle, states } from './inspect.js';
import { publish, service, action, teleop } from './actions.js';
import { log, diag } from './streams.js';
import { doctor, baseline, trigger, procmon, overview } from './health.js';
import { cloud } from './scene3d.js';
import { image } from './image.js';
import { map } from './map.js';
import { plotlab } from './plotlab.js';
import { bookmarks, jobs } from './bookmarks.js';

export const Views = {
  msgdef, qos, connections, tftree,
  publish, service, action,
  setparam, params, lifecycle,
  log, diag,
  doctor, baseline, trigger, procmon, overview,
  cloud, image, map, plotlab,
  teleop, states,
  bookmarks, jobs,
};
