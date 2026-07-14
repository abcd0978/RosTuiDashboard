// 액션(POST) — 발행/서비스콜/텔레옵/파라미터셋/노드 제어/셸 실행.
import { Router } from 'express';
import { looseJson } from '../../shared/rosbridge.js';
import { be, cleanRosCmd } from '../ros.js';
import { runOnce } from '../http.js';
import { rbCmdRequired, rbCmdEnsure, rbTopicType, setMeasure } from '../telemetry.js';
import { teleopStop, teleopSet } from '../jobs.js';

const router = Router();

function needRbCmd(req, res, next) { if (rbCmdRequired(res)) return; next(); }

router.post('/api/run', async (req, res) => res.json({ out: await runOnce(`${req.body.cmd} 2>&1`) }));
router.post('/api/clean-ros', async (req, res) => res.json({ out: await runOnce(cleanRosCmd()) }));

router.post('/api/param/set', async (req, res) => {
  const b = req.body;
  await runOnce(be.paramSet(b.node, b.name, b.value));
  res.json({ value: (await runOnce(be.paramGet(b.node, b.name))).trim() });
});

router.post('/api/publish', needRbCmd, async (req, res) => {
  const b = req.body;
  rbCmdEnsure().publish(b.name, await rbTopicType(b.name), looseJson(b.msg));
  res.json({ out: 'published (rosbridge)' });
});

router.post('/api/service', needRbCmd, async (req, res) => {
  const b = req.body;
  const v = await rbCmdEnsure().call(b.name, looseJson(b.req));
  res.json({ out: v == null ? '(no response)' : JSON.stringify(v, null, 2) });
});

router.post('/api/setparam1', async (req, res) => {
  const b = req.body;
  const cmd = be.setParam1(b.name, b.value);
  res.json({ out: cmd ? await runOnce(cmd) : '(ROS2: per-node)' });
});

router.post('/api/killnode', async (req, res) => {
  const b = req.body;
  const cmd = be.killNode(b.name);
  res.json({ out: cmd ? await runOnce(cmd) : '(no cmd)' });
});

router.post('/api/restart', async (req, res) => {
  const b = req.body;
  const cmd = be.restartNode(b.name);
  res.json({ out: cmd ? await runOnce(cmd) : '(no cmd)' });
});

router.post('/api/lifecycle', async (req, res) => res.json({ out: await runOnce(be.lifecycle(req.body.node, req.body.transition)) }));

router.post('/api/measure', (req, res) => { setMeasure(req.body.topics || []); res.json({ ok: true }); });   // 화면에 보이는 토픽만 Hz 측정

router.post('/api/teleop', needRbCmd, (req, res) => {
  const b = req.body;
  const topic = b.topic || '/cmd_vel';
  if (b.stop) teleopStop(topic);
  else teleopSet(topic, Number(b.lin) || 0, Number(b.ang) || 0, b.ty);
  res.json({ ok: true });
});

export default router;