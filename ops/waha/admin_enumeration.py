"""Bounded complete Admin list reads using the observed UI export mechanism."""
import json
import re
import urllib.parse

from renewal import SourceBlocked


class CompleteRows(list):
    """Rows plus aggregate completeness evidence; no response or contact logging."""

    def __init__(self, rows, reported_total, attempts):
        super().__init__(rows)
        self.reported_total = reported_total
        self.attempts = attempts
        self.proof = {
            'method': 'bounded_single_response_empty_terminal',
            'physical_rows': len(rows),
            'reported_total': reported_total,
            'attempts': attempts,
            'unique_internal_ids': True,
            'terminal_empty': True,
        }


def _response(value, cap):
    try:
        result = json.loads(value)
    except (ValueError, TypeError):
        raise SourceBlocked('admin_complete_list_response_schema') from None
    if not isinstance(result, dict):
        raise SourceBlocked('admin_complete_list_response_schema')
    total = result.get('recordsTotal')
    filtered = result.get('recordsFiltered')
    if type(total) is not int or not 0 <= total <= cap or type(filtered) is not int or filtered != total:
        raise SourceBlocked('admin_complete_list_count_schema')
    rows = result.get('data')
    if not isinstance(rows, list):
        raise SourceBlocked('admin_complete_list_rows_schema')
    return total, rows


def _identities(rows):
    identities = set()
    for row in rows:
        if not isinstance(row, list) or len(row) != 17:
            raise SourceBlocked('admin_complete_list_row_schema')
        matches = [identity for cell in row for identity in re.findall(
            r'/orders/view/(\d+)(?=[\'"<>\s]|$)', str(cell),
        )]
        found = {str(int(value)) for value in matches}
        if len(found) != 1:
            raise SourceBlocked('admin_complete_list_identity_schema')
        identity = next(iter(found))
        if identity in identities:
            raise SourceBlocked('admin_complete_list_duplicate_identity')
        identities.add(identity)


def complete_list(get, status='Active', cap=10000, attempts=3):
    """Restart changed single-response reads; never stitch offset pages together."""
    if status not in ('Active', 'pending'):
        raise SourceBlocked('admin_complete_list_status_not_allowed')
    if type(cap) is not int or not 1 <= cap <= 10000 or type(attempts) is not int or not 1 <= attempts <= 3:
        raise SourceBlocked('admin_complete_list_bounds_invalid')

    def path(start, length):
        return '/orders/ajaxlist/' + status + '?' + urllib.parse.urlencode({
            'draw': 1, 'start': start, 'length': length,
        })

    for attempt in range(1, attempts + 1):
        total, rows = _response(get(path(0, cap)), cap)
        if len(rows) > cap:
            raise SourceBlocked('admin_complete_list_cap_exceeded')
        _identities(rows)
        if len(rows) < total:
            raise SourceBlocked('admin_complete_list_undercoverage')
        terminal_total, terminal = _response(get(path(len(rows), 1)), cap)
        if len(terminal) > 1:
            raise SourceBlocked('admin_complete_list_terminal_schema')
        _identities(terminal)
        if terminal_total == total and not terminal:
            return CompleteRows(rows, total, attempt)
    raise SourceBlocked('admin_complete_list_changed_after_bounded_retries')
