// 라우팅 — 경로별 HTTP 핸들러(SSE 스트림 + JSON 액션). server.js 의 http.createServer 에 연결된다.
import { loadPreflight } from '../shared/preflight.js';
import { flattenSkeleton, buildYaml } from '../shared/msgform.js';
import { loadBookmarks, saveBookmarks, activePreset, presetNames, savePreset } from '../shared/bookmarks.js';
import { loadBaseline, saveBaseline } from '../shared/baseline.js';
import { looseJson } from '../shared/rosbridge.js';
import { VER, be, cleanRosCmd } from './ros.js';
import { json, readBody, runOnce, streamLines, serveFile } from './http.js';
import { rbRequired, rbCmdRequired, rbTelemetry, rbEcho, rbGraphSnapshot, getTelemSnapshot, rbEnsure, rbTopicType, rbCmdEnsure, setMeasure } from './telemetry.js';
import { jobs, jobView, spawnJob, killJob, teleopStop, teleopSet } from './jobs.js';

export async function router(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const q = url.searchParams;
  const post = req.method === 'POST';
  try {
    if (p === '/' || p === '/index.html') return serveFile(res, 'index.html');
    if (p === '/api/ver') return json(res, 200, { ver: VER });
    if (p === '/api/preflight') return json(res, 200, { checks: loadPreflight() });
    if (p === '/api/graph') {   // 타임아웃 시 마지막 정상 스냅샷 재사용
      const unavailable = rbRequired(res);
      if (unavailable) return;
      const snap = await rbGraphSnapshot();
      return json(res, 200, snap || getTelemSnapshot() || { items: [] });
    }

    // 스트림
    if (p === '/events') return rbRequired(res) || rbTelemetry(res);
    if (p === '/echo') return q.get('topic') ? (rbRequired(res) || rbEcho(res, q.get('topic'))) : json(res, 400, { error: 'topic' });
    if (p === '/imgstream') { const t = q.get('topic'); if (!t) return json(res, 400, { error: 'topic' }); return streamLines(res, be.imgBridge(t)); }
    // /cloudstream 은 WS 전용(바이너리). SSE 로는 제공하지 않음.
    if (p === '/markerstream') { const t = q.get('topic'); if (!t) return json(res, 400, { error: 'topic' }); return streamLines(res, be.markerBridge(t)); }
    if (p === '/tfstream') return streamLines(res, be.tfDump());
    if (p === '/annstream') { const t = q.get('topic'); if (!t) return json(res, 400, { error: 'topic' }); return streamLines(res, be.imgAnnBridge(t)); }
    if (p === '/caminfostream') { const t = q.get('topic'); if (!t) return json(res, 400, { error: 'topic' }); return streamLines(res, be.camInfoBridge(t)); }
    if (p === '/geomstream') { const t = q.get('topic'); if (!t) return json(res, 400, { error: 'topic' }); return streamLines(res, be.geomBridge(t, q.get('type') || '')); }
    if (p === '/urdfstream') return streamLines(res, be.urdfBridge());
    if (p === '/rosout') return rbRequired(res) || rbEcho(res, '/rosout');
    if (p === '/diagnostics') return rbRequired(res) || rbEcho(res, '/diagnostics');

    // 조회(one-shot)
    if (p === '/api/msgdef') return json(res, 200, { out: await runOnce(be.msgDef(q.get('type'))) });
    if (p === '/api/proto') {   // 발행 폼 프리필: 타입 스켈레톤 → flow-style YAML 한 줄 (TUI 와 동일)
      const cmd = be.proto(q.get('name'), q.get('type'));
      if (!cmd) return json(res, 200, { yaml: '{}' });
      try {
        const skel = JSON.parse((await runOnce(cmd)).trim() || '{}').skel || {};
        return json(res, 200, { yaml: buildYaml(flattenSkeleton(skel)) || '{}' });
      } catch {
        return json(res, 200, { yaml: '{}' });
      }
    }
    if (p === '/api/bagdump') {
      const out = await runOnce(be.bagDump(q.get('path'), q.get('topics')));
      try { return json(res, 200, JSON.parse(out)); } catch { return json(res, 200, { series: {}, error: out.slice(0, 300) }); }
    }
    if (p === '/api/connections') {
      const unavailable = rbRequired(res);
      if (unavailable) return unavailable;
      const kind = q.get('kind'), name = q.get('name'), rbc = rbEnsure();
      if (kind === 'topic') {
        const [pu, su, ty] = await Promise.all([rbc.call('/rosapi/publishers', { topic: name }), rbc.call('/rosapi/subscribers', { topic: name }), rbc.call('/rosapi/topic_type', { topic: name })]);
        return json(res, 200, { out: `Type: ${(ty && ty.type) || '?'}\nPublishers:\n  ${(((pu && pu.publishers) || []).join('\n  ')) || '(none)'}\nSubscribers:\n  ${(((su && su.subscribers) || []).join('\n  ')) || '(none)'}` });
      }
      const nd = await rbc.call('/rosapi/node_details', { node: name });
      return json(res, 200, { out: nd ? JSON.stringify(nd, null, 2) : '(rosbridge: 조회 실패)' });
    }
    if (p === '/api/resource') { const b = await readBody(req); return json(res, 200, { out: await runOnce(be.resource(b.nodes || [])) }); }
    if (p === '/api/measure' && post) { const b = await readBody(req); setMeasure(b.topics || []); return json(res, 200, { ok: true }); }   // 화면에 보이는 토픽만 Hz 측정
    if (p === '/api/tftree') return json(res, 200, { out: await runOnce(be.tfTree()) });
    if (p === '/api/tfecho') return json(res, 200, { out: await runOnce(be.tfEcho(q.get('src'), q.get('tgt'))) });
    if (p === '/api/bagcompare') return json(res, 200, { out: await runOnce(be.bagCompare(q.get('a'), q.get('b'))) });
    if (p === '/api/param/list') {
      return json(res, 200, {
        rows: (await runOnce(be.paramList(q.get('node')))).split('\n').filter(Boolean).map((l) => {
          const i = l.indexOf('\t');
          return { name: i < 0 ? l : l.slice(0, i), value: (i < 0 ? '' : l.slice(i + 1)).trim() };
        }),
      });
    }
    if (p === '/api/param/get1') {
      const name = q.get('name');
      const cmd = name && be.paramGet1(name);
      return json(res, 200, { out: cmd ? (await runOnce(cmd)).trim() : '(ROS2: 노드별 파라미터 — 노드의 params 에서 조회)' });
    }

    // 액션(POST)
    if (p === '/api/run' && post) { const b = await readBody(req); return json(res, 200, { out: await runOnce(`${b.cmd} 2>&1`) }); }
    if (p === '/api/clean-ros' && post) return json(res, 200, { out: await runOnce(cleanRosCmd()) });
    if (p === '/api/param/set' && post) {
      const b = await readBody(req);
      await runOnce(be.paramSet(b.node, b.name, b.value));
      return json(res, 200, { value: (await runOnce(be.paramGet(b.node, b.name))).trim() });
    }
    if (p === '/api/publish' && post) {
      const unavailable = rbCmdRequired(res);
      if (unavailable) return unavailable;
      const b = await readBody(req);
      rbCmdEnsure().publish(b.name, await rbTopicType(b.name), looseJson(b.msg));
      return json(res, 200, { out: 'published (rosbridge)' });
    }
    if (p === '/api/service' && post) {
      const unavailable = rbCmdRequired(res);
      if (unavailable) return unavailable;
      const b = await readBody(req);
      const v = await rbCmdEnsure().call(b.name, looseJson(b.req));
      return json(res, 200, { out: v == null ? '(no response)' : JSON.stringify(v, null, 2) });
    }
    if (p === '/api/setparam1' && post) { const b = await readBody(req); const cmd = be.setParam1(b.name, b.value); return json(res, 200, { out: cmd ? await runOnce(cmd) : '(ROS2: per-node)' }); }
    if (p === '/api/killnode' && post) { const b = await readBody(req); const cmd = be.killNode(b.name); return json(res, 200, { out: cmd ? await runOnce(cmd) : '(no cmd)' }); }
    if (p === '/api/restart' && post) { const b = await readBody(req); const cmd = be.restartNode(b.name); return json(res, 200, { out: cmd ? await runOnce(cmd) : '(no cmd)' }); }
    if (p === '/api/lifecycle' && post) { const b = await readBody(req); return json(res, 200, { out: await runOnce(be.lifecycle(b.node, b.transition)) }); }

    // 잡
    if (p === '/api/jobs' && !post) return json(res, 200, { jobs: [...jobs.values()].map(jobView) });
    if (p === '/api/job' && post) { const b = await readBody(req); const r = spawnJob(b.label || b.cmd, b.cmd); return json(res, 200, jobView(r)); }
    if (p === '/api/action' && post) { const b = await readBody(req); const r = spawnJob(`action ${b.name}`, be.actionGoal(b.name, b.type, b.goal)); return json(res, 200, jobView(r)); }
    if (p === '/api/teleop' && post) {
      const unavailable = rbCmdRequired(res);
      if (unavailable) return unavailable;
      const b = await readBody(req);
      const topic = b.topic || '/cmd_vel';
      if (b.stop) teleopStop(topic);
      else teleopSet(topic, Number(b.lin) || 0, Number(b.ang) || 0, b.ty);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/record' && post) {
      const b = await readBody(req);
      const out = `rdash_rec_${Date.now()}`;
      const r = spawnJob(`rosbag rec → ${out}`, be.bagRecord(b.topics && b.topics.length ? b.topics : null, out));
      return json(res, 200, jobView(r));
    }
    if (p === '/api/play' && post) { const b = await readBody(req); const r = spawnJob(`rosbag play ${b.path}`, be.bagPlay(b.path)); return json(res, 200, jobView(r)); }
    if (p.startsWith('/api/job/') && p.endsWith('/kill') && post) { const id = Number(p.split('/')[3]); const r = killJob(id); return json(res, 200, { ok: true, job: r ? jobView(r) : null }); }

    // 기준선(Baseline) — 프로파일은 브라우저가 계산해 저장, diff 도 브라우저에서.
    if (p === '/api/baseline' && !post) return json(res, 200, { baseline: loadBaseline() });
    if (p === '/api/baseline' && post) { const b = await readBody(req); saveBaseline(b.profile || {}); return json(res, 200, { ok: true }); }

    // 북마크
    if (p === '/api/bookmarks' && !post) return json(res, 200, { bookmarks: loadBookmarks(), preset: activePreset(), presets: presetNames() });
    if (p === '/api/bookmarks' && post) { const b = await readBody(req); saveBookmarks(b.bookmarks || [], activePreset()); return json(res, 200, { ok: true }); }
    if (p === '/api/preset' && post) {
      const b = await readBody(req);
      const names = presetNames();
      let name = b.name;
      if (!name && names.length) {
        const cur = activePreset();
        name = names[(names.indexOf(cur) + 1) % names.length];
      }
      if (name) savePreset(name);
      return json(res, 200, { preset: activePreset(), presets: names, bookmarks: loadBookmarks() });
    }

    // 그 외 GET 은 frontend/web/ 정적 파일(app 모듈·html·css). 없으면 404.
    if (!post) return serveFile(res, p);
    res.writeHead(404);
    res.end('not found');
  } catch (e) {
    json(res, 500, { error: String(e && e.message || e) });
  }
}
