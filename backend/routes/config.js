// 기준선(Baseline) · 북마크/프리셋 — 설정류 조회/저장.
import { Router } from 'express';
import { loadBookmarks, saveBookmarks, activePreset, presetNames, savePreset } from '../../shared/bookmarks.js';
import { loadBaseline, saveBaseline } from '../../shared/baseline.js';

const router = Router();

// 기준선(Baseline) — 프로파일은 브라우저가 계산해 저장, diff 도 브라우저에서.
router.get('/api/baseline', (req, res) => res.json({ baseline: loadBaseline() }));
router.post('/api/baseline', (req, res) => { saveBaseline(req.body.profile || {}); res.json({ ok: true }); });

// 북마크
router.get('/api/bookmarks', (req, res) => res.json({ bookmarks: loadBookmarks(), preset: activePreset(), presets: presetNames() }));
router.post('/api/bookmarks', (req, res) => { saveBookmarks(req.body.bookmarks || [], activePreset()); res.json({ ok: true }); });

router.post('/api/preset', (req, res) => {
  const b = req.body;
  const names = presetNames();
  let name = b.name;
  if (!name && names.length) {
    const cur = activePreset();
    name = names[(names.indexOf(cur) + 1) % names.length];
  }
  if (name) savePreset(name);
  res.json({ preset: activePreset(), presets: names, bookmarks: loadBookmarks() });
});

export default router;