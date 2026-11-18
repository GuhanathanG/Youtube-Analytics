from ytanalytics.llm import parse_json


def test_bare_list_is_wrapped_as_results():
    assert parse_json('[{"i": 1, "s": "positive"}]') == {"results": [{"i": 1, "s": "positive"}]}


def test_list_of_strings_does_not_crash_reader():
    data = parse_json('```json\n["a", "b"]\n```')
    # The archive reader skips non-dict items; the shape must still be a dict with results.
    assert data == {"results": ["a", "b"]}
