// Express 앱 조립 — 미들웨어, 도메인 라우터 마운트, 정적 파일, 에러 핸들러.
import express from 'express';
import { WEB } from './http.js';
import graphRoutes from './routes/graph.js';
import streamRoutes from './routes/streams.js';
import inspectRoutes from './routes/inspect.js';
import actionRoutes from './routes/actions.js';
import jobRoutes from './routes/jobs.js';
import configRoutes from './routes/config.js';

export const app = express();

// readBody() 원본은 Content-Type 을 안 보고 무조건 JSON 파싱을 시도했고, 실패하면 {} 로 넘어갔다.
// type:()=>true 로 그 동작을 재현하고, 파싱 실패는 다음 에러 미들웨어에서 {} 로 흡수한다.
// limit: readBody() 엔 크기 제한이 없었다 — 기본값(100kb)을 두면 큰 그래프의 /api/baseline 프로파일이 413 을 맞는다.
app.use(express.json({ type: () => true, limit: '50mb' }));
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') { req.body = {}; return next(); }
  next(err);
});

app.use(graphRoutes);
app.use(streamRoutes);
app.use(inspectRoutes);
app.use(actionRoutes);
app.use(jobRoutes);
app.use(configRoutes);

// 그 외 GET 은 frontend/web/ 정적 파일(app 모듈·html·css). 없으면 404.
app.use(express.static(WEB));
app.use((req, res) => { res.status(404).end('not found'); });

// 원본의 giant try/catch 대응 — Express 5 는 async 핸들러의 reject 를 자동으로 여기로 넘긴다.
app.use((err, req, res, next) => {
  res.status(500).json({ error: String((err && err.message) || err) });
});

export default app;