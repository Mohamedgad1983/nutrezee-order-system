#!/usr/bin/env python3
"""Dormant renewal-to-Bulk preparation; delivery is hard-locked in Bulk Store.

No command line, HTTP route, scheduler, network transport, credential access, or
runtime activation option is provided. Only synthetic temporary-database tests
currently invoke this bridge. Real dry-run acquisition/evaluation remains separate.
"""
from datetime import datetime, timezone

from renewal import KUWAIT, MESSAGE, SourceBlocked, phone


class RenewalBulk:
    def __init__(self, store, ledger, source, now=None):
        self.store, self.ledger, self.source = store, ledger, source
        self.now = now or (lambda: datetime.now(timezone.utc))

    def _recheck(self, subscription, normalized):
        # Fresh source read plus persisted opt-out/delivery history every time.
        # SourceBlocked aborts the entire Bulk transaction, never a partial draft.
        return self.ledger.recheck(self.source, subscription, normalized, self.now())

    def prepare(self):
        now = self.now()
        rows = self.source.read(now)
        candidates = []
        for row in rows:
            if not isinstance(row, dict):
                raise SourceBlocked('invalid_source_rows')
            subscription = row.get('subscription_id')
            if not isinstance(subscription, str) or not subscription.strip():
                raise SourceBlocked('missing_subscription_id')
            candidates.append((subscription, phone(row.get('phone'))))
        return self.store.prepare_renewals(
            'Renewal review ' + now.astimezone(KUWAIT).date().isoformat(),
            MESSAGE, candidates, self._recheck)

    def review(self, campaign):
        # This is an eligibility review, not a send claim or transport invocation.
        return self.store.review_renewals(campaign, self._recheck)
