// 상태/오버레이 슬롯 — 현재 모드에 맞는 컴포넌트 하나만 마운트(그 컴포넌트가 입력을 소유).
// 우선순위: 필드선택 > 검색 > 파라미터편집 > 기본 상태줄.
import { h } from '../react.js';
import { useDashboard } from '../store.js';
import { FieldPicker } from './FieldPicker.js';
import { SearchBar } from './SearchBar.js';
import { ParamEdit } from './ParamEdit.js';
import { StatusLine } from './StatusLine.js';

export function Overlay() {
  const { plotPick, searching, edit } = useDashboard();
  if (plotPick) return h(FieldPicker);
  if (searching) return h(SearchBar);
  if (edit) return h(ParamEdit);
  return h(StatusLine);
}
