// 잡 — 목록/생성/액션 goal/rosbag record·play/kill.
import { Router } from 'express';
import { be } from '../ros.js';
import { jobs, jobView, spawnJob, killJob } from '../jobs.js';

const router = Router();

router.get('/api/jobs', (req, res) => res.json({ jobs: [...jobs.values()].map(jobView) }));
router.post('/api/job', (req, res) => { const b = req.body; const r = spawnJob(b.label || b.cmd, b.cmd); res.json(jobView(r)); });
router.post('/api/action', (req, res) => { const b = req.body; const r = spawnJob(`action ${b.name}`, be.actionGoal(b.name, b.type, b.goal)); res.json(jobView(r)); });

router.post('/api/record', (req, res) => {
  const b = req.body;
  const out = `rdash_rec_${Date.now()}`;
  const r = spawnJob(`rosbag rec → ${out}`, be.bagRecord(b.topics && b.topics.length ? b.topics : null, out));
  res.json(jobView(r));
});

router.post('/api/play', (req, res) => { const b = req.body; const r = spawnJob(`rosbag play ${b.path}`, be.bagPlay(b.path)); res.json(jobView(r)); });

router.post('/api/job/:id/kill', (req, res) => {
  const id = Number(req.params.id);
  const r = killJob(id);
  res.json({ ok: true, job: r ? jobView(r) : null });
});

export default router;