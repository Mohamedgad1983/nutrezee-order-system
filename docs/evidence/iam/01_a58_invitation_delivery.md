# A58 — Fleet-Ops invitation delivery

Date: 2026-09-05. Status: configuration verified; SMTP activation blocked.

## Verified

- The two owner-requested users were created through supported IAM invitations with
  Administrator role; both remain Pending. Their original invitation jobs were
  identified by notification class and exact target user, without exposing tokens.
- Application Redis prefix is `nutreeze_database_`; the original queue and scheduler
  use `fleetbase_database_`. The original worker lacks the API environment mount and
  does not have the application's SMTP settings. Both invitations were stranded.
- A bounded application-context attempt processed exactly those two jobs. Gmail
  rejected authentication with SMTP 535; both jobs remain recoverable in failed_jobs.
- Owner selected Microsoft 365 `hello@nutreeze.com`. Its mailbox Authenticated SMTP
  was disabled; enabled and saved through Microsoft 365 admin center. The UI confirmed
  the update and the checked state. No other email-app or tenant setting was changed.
- Entra Properties reports that Security defaults are already disabled.
- Server-side TLS SMTP authentication checks still return 535 / 5.7.139, explicitly
  stating SmtpClientAuthentication is disabled for the tenant. No test email was sent.
- New opt-in worker overlay passes seven live Compose checks: application image,
  environment, volumes and networks match; no published ports; every existing
  service is unchanged; generated file permissions are 0600.
- Three isolated real-Compose fixture checks pass: literal dollar values survive
  round-trip rendering, inherited ports disappear and permissions remain 0600.
- Python syntax and git diff whitespace validation pass.

## Release boundary

The protected overlay is rendered on the host, but the new worker is not started.
SMTP credentials have not been installed into application configuration pending
validated authentication. No vendor source, existing worker, scheduler, dispatch,
Partner or legacy data changed. Do not retry all failed jobs. After authentication
works, configure the protected sender, activate only the application worker, and
retry the two exact original invitation jobs. Verify SMTP acceptance separately
from actual mailbox delivery. The original invitations expire after 48 hours.
