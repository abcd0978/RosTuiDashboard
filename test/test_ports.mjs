// shared/ports.js — 버전별 기본 포트 + env 오버라이드. 깨지면 두 컨테이너가 포트를 뺏는다.
//   실행: node test/test_ports.mjs
import assert from 'assert';
import { webPort, rosbridgeUrl } from '../shared/ports.js';

// env 없을 때: 버전이 포트를 가른다.
delete process.env.RDASH_WEB_PORT;
delete process.env.RDASH_ROSBRIDGE_URL;
assert.strictEqual(webPort('1'), 8080);
assert.strictEqual(webPort('2'), 8082);
assert.strictEqual(rosbridgeUrl('1'), 'ws://localhost:9090');
assert.strictEqual(rosbridgeUrl('2'), 'ws://localhost:9091');

// 알 수 없는 값/undefined 는 ROS1 로 떨어진다(기본 안전값).
assert.strictEqual(webPort(undefined), 8080);
assert.strictEqual(rosbridgeUrl('x'), 'ws://localhost:9090');

// env 오버라이드가 버전 기본값을 이긴다.
process.env.RDASH_WEB_PORT = '9999';
process.env.RDASH_ROSBRIDGE_URL = 'ws://elsewhere:1234';
assert.strictEqual(webPort('2'), 9999);
assert.strictEqual(rosbridgeUrl('1'), 'ws://elsewhere:1234');

console.log('✅ ports 8/8 통과 — ROS1 8080/9090 · ROS2 8082/9091 · env 오버라이드');
