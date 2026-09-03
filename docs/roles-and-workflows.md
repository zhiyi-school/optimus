# Roles, Authentication & Workflows

## Roles & Capabilities

Four roles: `developer`, `security`, `cio`, `admin`. **A user can hold more
than one role at once** — `profiles.roles` is an array, not a single value.
All role-gated UI goes through a single capability model
(`src/auth/permissions.ts`) — components call `can("run_test")`, never
`profile.roles.includes("security")`; a capability is granted if *any* of
a user's roles grants it. Frontend checks are UX only; **Supabase RLS is
the real authorization boundary** (`supabase/migrations/0002_rls.sql`,
`0003_storage.sql`, `0006_multi_role_admin.sql`).

| Capability | developer | security | cio | admin |
|---|---|---|---|---|
| view_dashboard | ✅ | ✅ | ✅ | ✅ |
| view_findings / view_tickets | ✅ | ✅ | ✅ | |
| view_assessments | | ✅ | ✅ | |
| view_risk_conversation | ✅ | ✅ | ✅ | |
| view_resolve | ✅ | | | |
| create_ticket / submit_fix / request_retest | ✅ | | | |
| update_control_progress / withdraw_ticket | ✅ | | | |
| comment_risk_conversation | ✅ | ✅ | | |
| run_test / update_finding / close_ticket / review_risk_acceptance / request_changes | | ✅ | | |
| view_executive_metrics | | | ✅ | |
| access_admin | | | | ✅ |

`admin` is deliberately separate from `security` — holding `security` does
**not** grant access to the Admin page (`/admin`); a user needs `admin`
specifically (in addition to, or instead of, any other role they hold). A
few UI spots (which dashboard to show, conversation bubble colour) need
to pick one representative role when a user has several — see
`primaryRole()` in `src/auth/permissions.ts` for the precedence order
(`security` > `cio` > `developer` > `admin`); this only affects display,
never authorization.

## Authentication

Supabase Auth (email/password) plus a `profiles` table for
application-specific data (`display_name`, `roles`, `team_id`,
`is_active`). `profiles.id` is the Supabase Auth user id. See
[SUPABASE_SETUP.md](./setup.md#role-assignment) for how initial
roles are assigned, and the [Admin page](./data-model.md#admin-page-teams-users-applications-roles)
for how roles get managed day-to-day.

### Post-login routing

```text
Developer opens the dashboard
        ↓
signs in through the existing Supabase Auth flow
        ↓
AuthProvider loads the profile: roles + team_id
        ↓
defaultRouteFor(profile) picks the landing route
        ↓
developer-only account  → /resolve
anything holding a security or admin capability → /
```

`defaultRouteFor()` and `resolveAccess()` in `src/auth/permissions.ts` are pure
functions over the profile, so the routing rules are unit-tested rather than
inferred from component behaviour. Neither reads `primaryRole()` — a user who
holds both `developer` and `security` keeps every security route *and* the
Resolve workspace.

### Developer account requirements

A developer account needs all three of these. Missing any one is a distinct,
visible state rather than a silent fallback:

```text
Authenticated Supabase Auth user
  + the `developer` role in profiles.roles
  + a non-null profiles.team_id
  + that team_id matching applications.developer_team_id
```

| Situation | What the developer sees at `/resolve` |
|---|---|
| Not signed in | Redirected to the login page |
| No `developer` role | "You do not have developer access" |
| `is_active = false` | "This account is deactivated" |
| No `team_id` | "Your account is not assigned to a team yet" — **no applications** |
| Team owns no applications | The empty state on an otherwise working page |

**A missing `team_id` never falls back to showing every application.** The
frontend refuses at the route guard, and `can_access_application()` in RLS
refuses independently — a developer with `team_id = null` matches no
application row, so even a direct query returns nothing.

### Setting up a developer account

1. The user signs up, or an administrator invites them, through the normal
   Supabase Auth flow. The `handle_new_user` trigger creates a `profiles` row
   with `roles = ['developer']`.
2. An administrator opens **Admin → Users**, confirms the `developer` role, and
   assigns the user to a developer team.
3. An administrator opens **Admin → Applications** and sets that team as the
   application's `developer_team_id`.

Placeholder values for a worked example:

```text
User:    developer@example.test
Role:    developer
Team:    Example Developer Team
team_id: example-team-id
```

Nothing here is developer-specific plumbing — it is the existing account model,
and there is no separate developer login.

## Risks, controls and steps

Three different things, deliberately kept apart:

```text
Risk               the security problem the assessment discovered
  └─ Control       the remediation approach that addresses it
       └─ Step     one action the developer performs to implement it
```

A **security demonstration** is a fourth thing: the steps security uses to
reproduce or validate the risk. It is shown on the Assess side and is never
presented to a developer as implementation instructions.

Risks come from the automation backend's `risks.yaml`. Controls and their steps
come from the backend's external playbook directory, served as structured JSON
(the dashboard never parses Markdown). Progress against those steps is the only
part stored here, in `ticket_controls` and `ticket_control_steps` — see
[data-model.md](./data-model.md#developer-remediation-progress).

### The playbook is always live

A ticket never pins a playbook version. Every title, instruction, code block,
screenshot and step ordering on an open ticket is whatever the backend serves
now, and progress is matched to it by the playbook's own **stable step id**.

While a ticket or control page is open the dashboard polls the backend's single
revision value, and refreshes when the window regains focus. If the playbook
changes underneath, the control definitions are refetched, progress is
reconciled, the new content appears, and a dismissible notice says
*"Remediation instructions were updated. You are viewing the latest steps."*
A completed step whose content changed during that session is marked for
re-reading; the old version is never stored and never shown.

| The playbook changes | What the developer sees |
| --- | --- |
| A step is reworded, or its screenshot or command changes | the new content, with their tick still on it |
| A step is reordered | the new order, with progress still attached |
| A step is added | it appears as not started and lowers the completion percentage |
| A step is removed | it disappears and stops counting; its record is kept but is not current work |
| A control is added or removed | the same, at control level |

### Reading a control before committing to it

A control can be read in full without a ticket. A finding page lists every
control the playbook links to the risk — title, summary, whether it is required,
how many steps, and whether the playbook marks it `active`, `deprecated` or
`deprioritized` — and each one opens a **preview**: the complete instructions,
screenshots, references and implementation example, with nothing writable.

```text
/findings/:findingId                                read the finding and its controls
/findings/:findingId/controls/:controlId            preview one control, read-only
```

Preview mode creates no `ticket_controls` or `ticket_control_steps` rows.
Steps cannot be ticked, notes cannot be added, and no fix or reassessment can be
submitted. The developer decides whether to start remediation only after
reading; stopping at the preview leaves no trace.

The same page is what a security or CIO account sees, because it is guarded by
`view_findings` rather than developer access. Whether progress can be recorded
is decided separately, by `update_control_progress`.

**Findings** is a top-level navbar item, so this route is reachable without
going through the dashboard or the Resolve tree. Every control card — in the
preview list and on a ticket — is a single link covering the whole card, so a
click anywhere on it opens the control.

## The risk conversation

Every application feature-risk has exactly one conversation, and it is the only
conversation dialogue in the dashboard. It lives with the risk it is about:

```text
one application
  -> one feature-risk
       -> one shared conversation
            messages, classification changes, remediation activity,
            reassessment requests and results, automated test history
```

An application is assessed many times, and all of it lands in the one thread:
opening the same risk from a later assessment continues the conversation rather
than starting another. It is where security and developers discuss that risk,
where security changes its classification, where a developer asks for a
reassessment, and where the reassessment's progress and outcome are recorded.

One chronological feed carries three things together — ordinary messages,
structured workflow events, and the automated runs the automation backend has
recorded for that risk — so a result, the decision it led to and the discussion
around it sit side by side. Each of the three is visually distinct, and an event
is never rendered as raw data. The automated runs are combined into the feed at
render time and are not copied into the conversation: the automation host stays
their only source. A run still going is shown separately, as live progress
rather than history, and a link to a specific run still highlights and scrolls
to it in the feed.

Everything else links to the conversation rather than repeating it. Finding
Detail, Ticket Detail and the Resolve ticket page each carry a link straight
into it; none of them has a composer of its own. A ticket records the
conversation *and* the assessment it was opened against, and keeps both for
good, so a later run that moves the finding's own assessment reference on cannot
send the ticket somewhere else.

| Who | May |
|---|---|
| Security | read, post, change the classification, run a test or retest |
| Developer | read and post on their own team's applications, request a reassessment when their remediation ticket is eligible |
| CIO | read |

A developer reaches the risk page for an application their team owns without
holding `view_assessments`: the route admits `view_risk_conversation` as well,
and RLS still decides what is visible, so an assessment outside their scope
comes back empty and the page says so. Reading a conversation grants nothing
else - a developer never gets test execution or classification.

Requesting a reassessment is still gated on the remediation workflow, and not
only in the UI: `enforce_retest_request_permissions` requires a non-security
caller to name a remediation ticket with a fix submitted, or one security sent
back, and refuses a ticket raised against a different risk. A developer with no
eligible ticket can still post a message and ask a question.

When an action cannot be used it stays visible and says why, rather than
disappearing: a developer with no remediation ticket is told to start one, one
who has not submitted a fix is told to do that first, and one whose
reassessment is already queued is told security has it. Security sees the same
treatment on the classification control when no result has been published for
the risk yet. Only one reassessment can be in flight per risk, and that is
enforced by the database, not just by hiding the button.

### Classification versus severity

The **classification** is the finding's status - At Risk, Reduced Risk or
Inconclusive - and it is changed in the risk conversation, by security, with a
required reason. One database function, `classify_risk()`, writes
`findings.status`, appends to `finding_history` and posts a
`classification_changed` event into the conversation in a single statement, so
the finding cannot change without the record of who changed it and why. Finding
Detail shows that history but no longer offers the control.

**Severity** - Critical, High, Medium, Low, Info - is test-result data and is
separate. Nothing in this workflow changes it.

A manual classification is not final: the automation backend stays the
authority, and a later real result supersedes it.

## Ticket Workflow

```text
Developer opens an At Risk / Inconclusive finding
   → reads the risk and the controls that address it
   → opens a control and reads every remediation step (no ticket yet)
   → "Start remediation" creates a remediation ticket
     (never edits the finding directly)
   → the ticket's required controls are initialised from the playbook
   → Developer works through each control's steps, marking them complete
   → Developer attaches evidence and submits fix info
   → in the risk conversation, Developer clicks "Request reassessment"
     → ticket → retest_requested
   → in the same conversation, Security Team clicks "Run Retest"
     → automation API runs the test
     → result synced back → finding status updated → ticket → under_review
     → the conversation records the outcome
   → Security Team closes the ticket
```

Discussion, classification and reassessment all live in the risk conversation
on the assessment's risk page, never on the ticket — see
[the risk conversation](#the-risk-conversation).

Completing every control step **does not** resolve the finding. It only makes
the control ready to submit; the finding's status changes on a real
reassessment result or an explicit Security Team override.

Security can send work back at any point with **Request Changes**, which moves
the ticket to `rejected` and posts the reason into the risk conversation. The
developer sees that as "Changes requested" and can submit again.

A finding has at most one remediation ticket in flight. When one is already
open, the finding offers **Continue remediation** instead of creating a second;
when the last one was withdrawn, it offers **Resume remediation**.

### Withdrawing versus closing

A developer who decides not to continue uses **Withdraw remediation**, which
moves the ticket to `withdrawn`. This is deliberately not `closed`:

| | `withdrawn` | `closed` |
|---|---|---|
| Who sets it | the developer | security |
| What it means | the developer stopped work | security verified the remediation |
| Finding afterwards | still unresolved, still needs remediation | whatever the reassessment found |
| `closed_at` | never set | set |
| Reversible by the developer | yes, as **Resume remediation** | no |

Withdrawal requires a written reason and records who withdrew and when. It is
offered only while the developer still owns the next step — `open`,
`in_progress`, `fix_submitted` or `rejected`. Once a reassessment has been
requested the work is in security's queue, so withdrawal is refused and the
decision is security's.

Nothing is lost: the risk conversation, evidence, control progress and
activity survive, and resuming puts the ticket back to `in_progress` with all
of it intact and the withdrawal still on the record.

### Developer-facing status labels

The Resolve workspace renames every ticket status for a developer audience:

| Internal status | Displayed as |
|---|---|
| `open` | Action required |
| `in_progress` | In progress |
| `fix_submitted` | Fix submitted |
| `retest_requested` | Awaiting reassessment |
| `retest_in_progress` | Security verification in progress |
| `under_review` | Under security review |
| `closed` | Resolved |
| `rejected` | Changes requested |
| `accepted` | Risk accepted |
| `withdrawn` | Withdrawn by developer |

### Who may do what

| Action | Developer | Security |
|---|---|---|
| Create a remediation ticket | ✅ | ✅ |
| Read and post in a risk conversation | ✅ | ✅ |
| Upload evidence | ✅ | ✅ |
| Update control-step progress | ✅ | |
| Submit a fix | ✅ | |
| Request a reassessment | ✅ | |
| Withdraw or resume a remediation | ✅ | |
| Run a reassessment or retest | | ✅ |
| Request changes | | ✅ |
| Change a risk's classification | | ✅ |
| Close a ticket | | ✅ |
| Approve risk acceptance | | ✅ |

Hiding a button is not authorization. Every row above is also enforced in the
database: `findings_update`, `retest_runs_update` and `risk_acceptance_update`
require the `security` role, and `enforce_ticket_update_permissions`
(`0018_ticket_withdrawal.sql`) rejects a developer's attempt to set a ticket to
`closed`/`accepted`/`retest_in_progress`, to reopen one security has finalised,
to withdraw one security is already verifying, or to change its ownership
fields — so the generic status mutation cannot be used to skip the workflow.
Withdrawal does not go through that mutation at all: `ticketData.withdraw()`
is a separate call that refuses an empty reason, and `updateStatus()` rejects
`withdrawn` outright so the reason and actor can never be skipped.

## Developer Resolve workspace

```text
/resolve                                                applications in your team's scope
/resolve/applications/:applicationId                    one application's remediation progress
/resolve/findings/:findingId/controls/:controlId        preview a control before starting
/resolve/tickets/:ticketId                              one finding's remediation workspace
/resolve/tickets/:ticketId/controls/:controlId          one control's ordered steps, writable
```

A ticket's controls are clickable wherever they appear. On the generic ticket
page they link to `/tickets/:ticketId/controls/:controlId`, which renders the
same control but is guarded by `view_tickets`, so a security reviewer can read
what the developer is working through without holding developer access.

Progress is reported with two formulas, both computed in `src/lib/resolve.ts`:

```text
Application finding progress   resolved findings / total actionable findings
Control progress               completed required control steps / total required control steps
```

"Actionable" means `at_risk` or `reduced_risk`; `inconclusive` findings are
excluded because they are security's call, not developer work. Only **active,
required** controls count toward control progress — a control the playbook marks
`deprioritized` or `deprecated` is never counted as required work and is not
initialised onto a new ticket.

Withdrawn tickets are excluded from every active count — required controls,
controls in progress, fixes submitted and awaiting security — and are never
counted as resolved. They stay visible in the application's ticket list and
carry their own count, so the history remains readable.

Application remediation progress is not test-execution progress. It says how far
the developers have got, not how far security has got through running tests.

## Risk Acceptance Workflow

"Accept Risk" creates a **risk_acceptance** ticket + a `risk_acceptance`
row — it never sets the finding to Reduced Risk directly. The Security
Team reviews and accepts/rejects the *business* record
(`risk_acceptance.decision`); the finding's technical `status` is a
separate field that only changes via an actual retest result or an
explicit Security Team override. A finding can legitimately still read
**At Risk** while an accepted-risk record exists — both stay visible.

## Assessment execution

Creating an assessment queues a durable request; a backend worker runs it. The
assessment page shows and steers that, but never drives it — closing the tab
changes nothing.

```text
Security Team adds an app
   → an assessment is created, and a run request queued with it
   → the worker checks whether the app can actually run now
     → it can          → the run starts, the assessment goes to running
     → it cannot yet   → the assessment goes to waiting, with a reason,
                         and the worker tries again on its own
     → it never will   → the assessment fails, and says what to change
   → the sync worker imports the report → completed
```

Configuration being finished is not the same as being able to run: the device
may be unplugged. Those are reported separately, so an assessment whose setup is
complete but whose device is missing shows **Waiting for a compatible test
device** rather than a completed setup or a raw error.

A queued, waiting or failed assessment stays open and readable from the
assessments list — the row navigates, and the chevron beside it expands setup
progress without taking navigation away. Where an assessment is stuck for a
reason someone can clear, the page offers **Retry now**; where it is stuck for a
reason nobody can, it says so and links to the configuration instead. Retrying
reuses the same assessment and the same request, so clicking twice, refreshing,
or having two tabs open cannot start two runs.

| State | What it means |
|---|---|
| Queued for automated testing | waiting for a worker to pick it up |
| Preparing the test environment | a worker has it and is checking readiness |
| Waiting for … | blocked on something temporary; retries itself |
| Automated tests are running | on the device now |
| Test execution could not start | blocked on something that needs a change |
| Completed | the report has been imported |

## App Provisioning Workflow

```text
Security Team clicks "Add App" on the Assessments page
   → registers the application + a placeholder assessment
   → opens an app_provisioning ticket (no finding yet — none exists)
   → Security downloads the app onto a device (+ registers it under the
     test Apple ID, for iOS)
   → Security closes the ticket
   → app is ready to select in "Run Automated Test"
```

`app_provisioning` is the one ticket type not created from a finding —
`tickets.finding_id` is nullable specifically for it
(`0007_app_provisioning.sql`). It's tracking only: closing the ticket
doesn't unlock anything programmatically, since what's actually runnable
is governed by the automation backend's own app roster
(`GET /config/{platform}/apps`), not this dashboard's DB.
