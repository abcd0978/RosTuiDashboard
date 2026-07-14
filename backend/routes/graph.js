// /api/ver · /api/env · /api/graph · /api/preflight — 그래프 스냅샷과 백엔드 환경 조회.
import { Router } from 'express';
import { hostname } from 'os';
import { loadPreflight } from '../../shared/preflight.js';
import { VER, be } from '../ros.js';
import { rbRequired, rbGraphSnapshot, getTelemSnapshot } from '../telemetry.js';

const router = Router();

function needRb(req, res, next) { if (rbRequired(res)) return; next(); }

router.get('/api/ver', (req, res) => res.json({ ver: VER }));

// 백엔드가 실제로 붙어 있는 ROS 환경. 클라이언트(TUI/웹)의 process.env 는 ROS 와 무관하므로
// 반드시 여기서 받아야 한다 — 클라이언트가 자기 env 를 읽으면 엉뚱한 값을 보여준다.
router.get('/api/env', (req, res) => {
  res.json({
    ver: VER,
    backend: be.kind,                                        // cli | rcl | rosbridge
    url: be.url || '',                                       // rosbridge 일 때의 websocket 주소
    host: hostname(),
    domain: process.env.ROS_DOMAIN_ID || '0',                // ROS2 전용(DDS 논리 분리). ROS1 에선 의미 없음
    rmw: (process.env.RMW_IMPLEMENTATION || 'default').replace('rmw_', '').replace('_cpp', ''),
    master: process.env.ROS_MASTER_URI || '',                // ROS1 전용
  });
});

router.get('/api/preflight', (req, res) => res.json({ checks: loadPreflight() }));

// 타임아웃 시 마지막 정상 스냅샷 재사용
router.get('/api/graph', needRb, async (req, res) => {
  const snap = await rbGraphSnapshot();
  res.json(snap || getTelemSnapshot() || { items: [] });
});

export default router;