# A58 — Fleet-Ops invitation delivery

Date: 2026-09-05. Status: LIVE; Exchange message trace confirms both invitations Delivered.

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
- Initial TLS SMTP checks returned 535 / 5.7.139 during propagation of the mailbox
  exception. Authentication subsequently succeeded without any tenant-wide setting
  change. The tenant SMTP prohibition remains enabled; only hello has the new exception.
- New opt-in worker overlay passes seven live Compose checks: application image,
  environment, volumes and networks match; no published ports; every existing
  service is unchanged; generated file permissions are 0600.
- Three isolated real-Compose fixture checks pass: literal dollar values survive
  round-trip rendering, inherited ports disappear and permissions remain 0600.
- Python syntax and git diff whitespace validation pass.

## Release verification

- PR #77 merged as `2a1268e`; source `017aa61`. Push and PR CI runs
  `33970309094` and `33970341572` passed 14/14 each (CodeRabbit also passed).
  Post-merge main run `33970517610` also passed 14/14.
- Installed Microsoft 365 SMTP at smtp.office365.com:587 with TLS in the existing
  root-protected API environment file, preserving its bind-mounted inode. The
  previous configuration backup remains root-protected on the host. No credential
  is present in source, evidence or generated public artifacts.
- Started only `fleetbase-application-queue-1`. It is running and healthy.
- Matched the two original failed notification jobs to the exact requested users,
  then retried only those two UUIDs through the supported Laravel queue command.
- Both `UserInvited` jobs completed DONE at 14:01:50/51 UTC (17:01 Kuwait), with
  no queued/reserved jobs and no original failed jobs remaining. Microsoft accepted
  both messages. No duplicate user or replacement invitation was created.
- Existing application, queue, scheduler and dispatch services were not restarted.
  No Fleetbase vendor code, Partner or legacy data changed.
- Exchange message trace, scoped to hello@nutreeze.com, returned exactly two
  invitation messages at 17:01 Kuwait: callcenter@nutreeze.com — Delivered;
  Sulayman@nutreeze.com — Delivered. Subject: the standard Nutreeze Fleetbase
  invitation. No message bodies or invitation tokens were read or saved.
- All four application/queue/scheduler containers are healthy. The three existing
  services retain their September 3 start times; only the new worker started today.
