// 터미널 크기(리사이즈 반영)
import { useState, useEffect } from '../react.js';

export function useTermSize() {
  const [s, setS] = useState({ cols: process.stdout.columns || 100, rows: process.stdout.rows || 30 });
  useEffect(() => {
    const on = () => setS({ cols: process.stdout.columns || 100, rows: process.stdout.rows || 30 });
    process.stdout.on('resize', on);
    return () => process.stdout.off('resize', on);
  }, []);
  return s;
}
