// 상태/오버레이 슬롯 — 현재 모드에 맞는 컴포넌트 하나만 마운트(그 컴포넌트가 입력을 소유).
// 우선순위: 북마크추가 > 북마크 > 도메인 > 필드선택 > 검색 > 파라미터편집 > 기본 상태줄.
import { h } from '../react.js';
import { useDashboard } from '../store.js';
import { FieldPicker } from './FieldPicker.js';
import { SearchBar } from './SearchBar.js';
import { ParamEdit } from './ParamEdit.js';
import { DomainEdit } from './DomainEdit.js';
import { Bookmarks } from './Bookmarks.js';
import { BookmarkAdd } from './BookmarkAdd.js';
import { StatusLine } from './StatusLine.js';

export function Overlay() {
  const { plotPick, searching, edit, domainEdit, bmOpen, bmAdd } = useDashboard();
  if (bmAdd) return h(BookmarkAdd);
  if (bmOpen) return h(Bookmarks);
  if (domainEdit) return h(DomainEdit);
  if (plotPick) return h(FieldPicker);
  if (searching) return h(SearchBar);
  if (edit) return h(ParamEdit);
  return h(StatusLine);
}
