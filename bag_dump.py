#!/usr/bin/env python3
"""rosbag2 를 읽어 지정 토픽의 숫자 리프 필드 시계열을 JSON 으로 덤프. 웹 PlotLab '파일 재생'용.
사용: python3 bag_dump.py <bag_path> [topicA|topicB|...]
출력: {"series": {"<topic> <field.path>": [[t,v],...]}, "t0":0, "t1":<span_sec>}"""
import sys
import json


def numeric_leaves(msg, prefix, out):
    try:
        fields = msg.get_fields_and_field_types()
    except Exception:
        return
    for name in fields:
        try:
            v = getattr(msg, name)
        except Exception:
            continue
        p = prefix + '.' + name if prefix else name
        if isinstance(v, bool):
            continue
        if isinstance(v, (int, float)):
            out[p] = float(v)
        elif hasattr(v, 'get_fields_and_field_types'):
            numeric_leaves(v, p, out)


def main():
    path = sys.argv[1]
    want = set(t for t in (sys.argv[2].split('|') if len(sys.argv) > 2 else []) if t) or None
    from rosbag2_py import SequentialReader, StorageOptions, ConverterOptions
    from rclpy.serialization import deserialize_message
    from rosidl_runtime_py.utilities import get_message
    import os

    def detect_storage():
        # metadata.yaml 의 storage_identifier 우선, 없으면 파일 확장자로(sqlite3=.db3 / mcap=.mcap).
        meta = os.path.join(path, 'metadata.yaml')
        try:
            import yaml
            with open(meta) as f:
                sid = yaml.safe_load(f).get('rosbag2_bagfile_information', {}).get('storage_identifier')
                if sid:
                    return sid
        except Exception:
            pass
        try:
            files = os.listdir(path) if os.path.isdir(path) else [path]
        except Exception:
            files = []
        if any(fn.endswith('.mcap') for fn in files):
            return 'mcap'
        return 'sqlite3'

    reader = SequentialReader()
    opened = False
    for sid in (detect_storage(), 'sqlite3', 'mcap', ''):
        try:
            reader.open(StorageOptions(uri=path, storage_id=sid), ConverterOptions('cdr', 'cdr'))
            opened = True
            break
        except Exception:
            reader = SequentialReader()
    if not opened:
        print(json.dumps({"series": {}, "error": "bag open 실패(경로/스토리지 플러그인 확인)"}))
        return
    types = {t.name: t.type for t in reader.get_all_topics_and_types()}
    series, t0, t1 = {}, None, None
    while reader.has_next():
        topic, data, ts = reader.read_next()
        if (want and topic not in want) or topic not in types:
            continue
        try:
            msg = deserialize_message(data, get_message(types[topic]))
        except Exception:
            continue
        tsec = ts / 1e9
        if t0 is None:
            t0 = tsec
        t1 = tsec
        leaves = {}
        numeric_leaves(msg, '', leaves)
        rel = round(tsec - t0, 4)
        for k, v in leaves.items():
            series.setdefault(topic + ' ' + k, []).append([rel, v])
    print(json.dumps({'series': series, 't0': 0, 't1': (t1 - t0) if t0 is not None else 0}))


if __name__ == '__main__':
    main()
