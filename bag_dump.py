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
    reader = SequentialReader()
    try:
        reader.open(StorageOptions(uri=path, storage_id='sqlite3'), ConverterOptions('cdr', 'cdr'))
    except Exception:
        reader.open(StorageOptions(uri=path), ConverterOptions('', ''))
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
