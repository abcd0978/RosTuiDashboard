// SSE 스트림 — 텔레메트리 이벤트 + 센서/브리지 스트림(/imgstream 등). WS 버전은 ws.js 참조.
import { Router } from 'express';
import { be } from '../ros.js';
import { streamLines } from '../http.js';
import { rbRequired, rbTelemetry, rbEcho } from '../telemetry.js';

const router = Router();

function needRb(req, res, next) { if (rbRequired(res)) return; next(); }
function needTopic(req, res, next) { if (!req.query.topic) return res.status(400).json({ error: 'topic' }); next(); }

// 스트림
// /events·/echo 에는 needRb 를 걸지 않는다 — 503 으로 거절하면 백엔드 기동 직후(rosbridge 가 아직
// ros2 launch 중인 수 초) 붙은 클라이언트가 영구히 데이터를 못 받는다. 오래 사는 스트림은 일단
// 등록하고 rosbridge 가 준비되면 흐르게 하는 게 맞다(telemTick 이 그동안 nomaster 를 보낸다).
// 단발 요청(publish/service 등)에는 needRb 가 여전히 옳다 — 그건 지금 수행할 수 없는 요청이니까.
router.get('/events', (req, res) => rbTelemetry(res));
router.get('/echo', needTopic, (req, res) => rbEcho(res, req.query.topic, req.query.type));
router.get('/imgstream', needTopic, (req, res) => streamLines(res, be.imgBridge(req.query.topic)));
// /cloudstream 은 WS 전용(바이너리). SSE 로는 제공하지 않음.
router.get('/markerstream', needTopic, (req, res) => streamLines(res, be.markerBridge(req.query.topic)));
router.get('/tfstream', (req, res) => streamLines(res, be.tfDump()));
router.get('/annstream', needTopic, (req, res) => streamLines(res, be.imgAnnBridge(req.query.topic)));
router.get('/caminfostream', needTopic, (req, res) => streamLines(res, be.camInfoBridge(req.query.topic)));
router.get('/geomstream', needTopic, (req, res) => streamLines(res, be.geomBridge(req.query.topic, req.query.type || '')));
router.get('/urdfstream', (req, res) => streamLines(res, be.urdfBridge()));
router.get('/rosout', needRb, (req, res) => rbEcho(res, '/rosout'));
router.get('/diagnostics', needRb, (req, res) => rbEcho(res, '/diagnostics'));
// 대역폭 — rosapi 로는 잴 수 없다(메시지 바이트 크기를 모른다). 백엔드 호스트의 ROS CLI 로 잰다.
router.get('/api/bw', needTopic, (req, res) => streamLines(res, be.bandwidth(req.query.topic)));

export default router;