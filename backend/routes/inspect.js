// 조회(one-shot) — 메시지 정의/발행 프리필/연결 정보/TF/파라미터/리소스/백 덤프 등.
import { Router } from 'express';
import { flattenSkeleton, buildYaml } from '../../shared/msgform.js';
import { be } from '../ros.js';
import { runOnce } from '../http.js';
import { rbRequired, rbEnsure } from '../telemetry.js';

const router = Router();

function needRb(req, res, next) { if (rbRequired(res)) return; next(); }

router.get('/api/msgdef', async (req, res) => res.json({ out: await runOnce(be.msgDef(req.query.type)) }));

// 발행/호출 폼 프리필: 타입 스켈레톤 → flow-style YAML 한 줄 + 스켈레톤 자체
// 웹은 yaml 만 쓰지만(textarea 프리필), TUI 는 필드별 입력 폼을 그리므로 skel 이 필요하다.
// kind 생략 시 topic(기존 클라이언트 호환) — service 는 그래프 스냅샷에 ty 가 없어 이름으로 타입을 조회한다.
router.get('/api/proto', async (req, res) => {
  const cmd = be.proto(req.query.kind || 'topic', req.query.name, req.query.type);
  if (!cmd) return res.json({ yaml: '{}', skel: null, type: '' });
  try {
    const parsed = JSON.parse((await runOnce(cmd)).trim() || '{}');
    const skel = parsed.skel || {};
    return res.json({ yaml: buildYaml(flattenSkeleton(skel)) || '{}', skel, type: parsed.type || '' });
  } catch {
    return res.json({ yaml: '{}', skel: null, type: '' });
  }
});

router.get('/api/bagdump', async (req, res) => {
  const out = await runOnce(be.bagDump(req.query.path, req.query.topics));
  try { return res.json(JSON.parse(out)); } catch { return res.json({ series: {}, error: out.slice(0, 300) }); }
});

router.get('/api/connections', needRb, async (req, res) => {
  const kind = req.query.kind, name = req.query.name, rbc = rbEnsure();
  if (kind === 'topic') {
    const [pu, su, ty] = await Promise.all([rbc.call('/rosapi/publishers', { topic: name }), rbc.call('/rosapi/subscribers', { topic: name }), rbc.call('/rosapi/topic_type', { topic: name })]);
    return res.json({ out: `Type: ${(ty && ty.type) || '?'}\nPublishers:\n  ${(((pu && pu.publishers) || []).join('\n  ')) || '(none)'}\nSubscribers:\n  ${(((su && su.subscribers) || []).join('\n  ')) || '(none)'}` });
  }
  if (kind === 'service') {   // rosservice info 대응 — 타입 + 제공 노드.
    // /rosapi/service_providers 는 ROS1 에서 늘 빈 배열을 준다(쓰지 말 것). service_node 가 실제 답을 준다.
    const [ty, nd2] = await Promise.all([rbc.call('/rosapi/service_type', { service: name }), rbc.call('/rosapi/service_node', { service: name })]);
    return res.json({ out: `Type: ${(ty && ty.type) || '?'}\nNode: ${(nd2 && nd2.node) || '(unknown)'}` });
  }
  const nd = await rbc.call('/rosapi/node_details', { node: name });
  return res.json({ out: nd ? JSON.stringify(nd, null, 2) : '(rosbridge: 조회 실패)' });
});

router.post('/api/resource', async (req, res) => {
  const b = req.body;
  res.json({ out: await runOnce(be.resource(b.nodes || [])) });
});

router.get('/api/tftree', async (req, res) => res.json({ out: await runOnce(be.tfTree()) }));
router.get('/api/tfecho', async (req, res) => res.json({ out: await runOnce(be.tfEcho(req.query.src, req.query.tgt)) }));
router.get('/api/bagcompare', async (req, res) => res.json({ out: await runOnce(be.bagCompare(req.query.a, req.query.b)) }));

router.get('/api/param/list', async (req, res) => {
  res.json({
    rows: (await runOnce(be.paramList(req.query.node))).split('\n').filter(Boolean).map((l) => {
      const i = l.indexOf('\t');
      return { name: i < 0 ? l : l.slice(0, i), value: (i < 0 ? '' : l.slice(i + 1)).trim() };
    }),
  });
});

router.get('/api/param/get1', async (req, res) => {
  const name = req.query.name;
  const cmd = name && be.paramGet1(name);
  res.json({ out: cmd ? (await runOnce(cmd)).trim() : '(ROS2: 노드별 파라미터 — 노드의 params 에서 조회)' });
});

export default router;