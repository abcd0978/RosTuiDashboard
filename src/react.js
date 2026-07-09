// React 재노출 — 프로젝트 전역에서 하이퍼스크립트 h 와 훅들을 한 곳에서 가져온다.
import React from 'react';

export const h = React.createElement;
export const {
  useState, useEffect, useRef, useMemo, useCallback,
  useContext, createContext, Fragment,
} = React;
export default React;
