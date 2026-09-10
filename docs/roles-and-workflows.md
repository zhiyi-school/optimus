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
| create_ticket / request_retest | ✅ | | | |
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

Every code block a control renders — in the control introduction, the control
preview, and the guided remediation steps — comes from one shared component with
a **Copy** button that writes the whole block. The clipboard receives the
backend's own `text` for that block, so indentation, blank lines and special
characters survive exactly, and fence delimiters, the language label and the
highlighting never reach it. Swift and shell blocks are tokenised for colour;
any other language, or none, renders as plain text. Copying confirms only after
the write succeeds; a browser that refuses clipboard access says so and leaves
the code selectable rather than reporting a copy that did not happen.

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

The current read-only preview is
`/resolve/findings/:findingId/controls/:controlId`. Legacy `/findings/...` and
`/tickets/...` URLs are redirect shims into the assessment or Resolve risk
workspace; they are not standalone finding or ticket pages.

Preview mode creates no `ticket_controls` or `ticket_control_steps` rows.
Steps cannot be ticked, notes cannot be added, and no fix or reassessment can be
submitted. The developer decides whether to start remediation only after
reading; stopping at the preview leaves no trace.

The same page is what a security or CIO account sees, because it is guarded by
`view_findings` rather than developer access. Whether progress can be recorded
is decided separately, by `update_control_progress`.

Every control card — in the preview list and on a ticket — is a single link
covering the whole card, so a click anywhere on it opens the control.

## The conversation

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

Neither risk workspace renders a broad static-analysis findings table. The run's
structured reports are still produced, stored and served unchanged: they reach a
reader as ordinary artifacts in the evidence rail, where each one has its own
View and Download. Removing the table changed presentation only — no finding,
report or artifact reference was dropped.

In its place both workspaces show one focused **Exposed plaintext literals**
card, the same for security and for the owning developer. It reads the run's
structured `sensitive_information_findings` from `ipa_analysis.json` — never
regex over a human-readable summary — and shows the category, the location, the
masked value and the reason each item was flagged, with a link to the playbook
control that addresses it.

Only detections the plaintext-literal risk is about are listed: potential
embedded credentials, potential hardcoded secret keys and tokens, and URLs that
carry credentials. Other sensitive values appear only when the analyzer gave a
specific reason, such as a key whose name states it holds a secret. Security
scores, package inspectability, permissions, encryption metadata, ordinary
public URLs and public identifiers are other subjects and are deliberately
absent, as are API-key reuse outcomes.

Categories stay hedged — "potential", "suspected" — because a pattern match is
not proof a credential is valid, and the dashboard never tests one. Only
`masked_value` is ever read: a report captured with `reveal_values` enabled
still cannot put a raw secret on screen. A match seen only inside an analyzer's
own report is labelled as such rather than given a source file it never had.

The card distinguishes four states, because none of them means the same thing:
literals found, the scan ran and matched nothing ("No matching plaintext
literals reported in this run."), the scan did not run, and the analysis could
not be loaded or is an unsupported schema. A failed request is never rendered as
an empty result.

The **Latest automated result** card summarises the newest run at the top of the
Assess risk workspace. It is shown to readers who do not hold the `security`
role; security reads the same run — verdict, status, timestamp and summary —
from the conversation's own history, so the card would only repeat it. A profile
holding `security` alongside any other role is still security for this purpose.
The Resolve workspace has never shown the card.

Everything else links or redirects to the conversation rather than repeating
it. Legacy finding and ticket URLs resolve into the assessment or Resolve risk
workspace; there are no standalone detail pages with separate composers. A ticket records the
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

Requesting a reassessment is gated on the remediation workflow, and not only in
the UI: `enforce_retest_request_permissions` requires a non-security caller to
name an eligible remediation with an approach selected, and refuses a ticket
raised against a different risk. A developer with no eligible ticket can still
post a message and ask a question.

**Several requests may be outstanding at once.** Each intentional Send creates
its own request, even while an earlier one is queued or running, and each gets
its own conversation event and attachment. Retrying the same Send does not add a
second request: the submission carries an identifier that the database
deduplicates on, scoped to the conversation and the requester, so a retry after
a lost response resolves to the request that write already made. Security runs
them one at a time, oldest first, and starts each explicitly — nothing executes
on its own, and only one reassessment per risk can be running. Migration `0030`
replaced the one-active-request index with an at-most-one-*running* rule plus
that submission identity.

**Remediation progress is not a condition.** A developer may ask for a
reassessment with none, some or all of the approach's steps marked complete, and
whether progress rows exist or have finished reconciling makes no difference to
eligibility. Ticking steps records the developer's own tracking; security still
runs the reassessment and decides the classification from its result. Migration
`0029` removed the progress-row, non-zero-step and completion checks from the
trigger while keeping every other condition. A dashboard offering a request on
incomplete progress against a database still on `0028` or earlier is refused by
that older trigger with "complete every step of the selected remediation
approach first", so `0029` must be applied before that frontend is deployed.

Both actions live inside the conversation composer rather than as buttons above
the thread, and both are *additions* to an ordinary message rather than a
different way of writing one. They sit at the top of the composer, above the
message box: the offered actions first, then the selected action's chip and its
options, then the message box with Attach and Send, then the chosen file and any
submission feedback. That is the real DOM order, so keyboard focus follows what
the reader sees, and the row disappears entirely — leaving no gap — when a reader
is offered nothing. The message box, its placeholder, the attachment control and
the Send button never change; a permitted user adds **Change classification** or
**Request reassessment** as a removable chip, and Send then records that workflow
step as well. Adding, swapping or removing a chip leaves the draft and any chosen
file untouched.

Classification uses the message as its required reason and refuses the
classification the risk already has. A reassessment needs no text, and anything
typed is carried as context on the request event rather than posted a second
time.

A file can be attached in all three cases. It is stored against the entry the
action created — the `classification_changed` event, the `retest_requested`
event, or the message itself — so a decision and its evidence are one timeline
item. `classify_risk_entry()` returns the entry id it wrote rather than leaving
the browser to search for it, which would race a concurrent classification of
the same risk.

Submission has one coordinator for messages, classifications and reassessment
requests. Its state is `idle → recording → attaching → complete`. A failure in
`recording` preserves the draft and may retry the workflow operation. Once
recording succeeds, the coordinator retains the exact conversation, entry id,
action, message, file object and storage key. A later attachment failure cannot
repeat the workflow operation: the composer is locked to **Retry file** or the
explicit **Abandon file retry** action. Replacing a file with another file that
happens to have the same name is not a retry identity.

Bytes and attachment metadata are separate writes. If bytes succeeded but the
metadata response failed, retry first looks for the same storage key and then
persists only the missing metadata; it does not upload another object. Entry
queries refresh as soon as recording succeeds, even if attachment work fails,
and attachment queries refresh only after metadata is readable. Abandoning or
leaving the conversation clears the in-memory retry and removes an uploaded
object only after confirming that it has no metadata row. A page reload loses
an unfinished in-memory retry; it never guesses a recent entry or attachment.

Every attached file is listed under its timeline item, whether it hangs off a
message or a workflow event. Who may read it is decided by access to the
conversation, never by who uploaded it. Supabase-backed attachments have a
**Download** action that fetches the bytes and saves them as a Blob under the
name the uploader gave the file, so a refusal is reported with a **Try again**
rather than written to disk under the
file's name. Links are signed one download at a time and never cached, so a
stale link cannot outlive the reader's access.

`storage_provider: "server"` is metadata supported by migration `0027`, but the
dashboard has no server attachment provider yet. Such an attachment is listed and
its download reports that it is unsupported. This is separate from downloadable
automation report evidence, which comes from the automation API by opaque `ref`.
See the [compatibility matrix](./frontend-integration.md#database-and-api-compatibility).

**Enter** sends the message; **Shift+Enter** starts a new line. Enter goes
through the same form the Send button submits, so a classification chip, a
reassessment chip and an attached file are all carried exactly as they are when
Send is clicked, and the same validation applies — an empty composer, a
classification with no reason, or a send already in flight all do nothing. An
input method's Enter, which accepts a candidate rather than finishing a
sentence, never sends.

**Run Retest** acts immediately and so stays outside the composer.

Developers no longer withdraw a reassessment from the dashboard: the control is
gone from the conversation actions. This is a UI removal only — the
`withdraw_reassessment()` RPC, its permissions and its `retest_withdrawn`
history are untouched, and past withdrawal events still read in the feed.

When an action cannot be used it stays visible and says why, rather than
disappearing: a developer with no remediation ticket is told to start one, one
with no approach chosen is told to choose one, and one whose reassessment is
already queued is told security has it. Security sees the same
treatment on the classification control when no result has been published for
the risk yet. Only one reassessment can be in flight per risk, and that is
enforced by the database, not just by hiding the button.

### Classification versus severity

The **classification** is the finding's status - At Risk, Reduced Risk or
Inconclusive - and it is changed in the conversation, by security, with a
required reason. `classify_risk_entry()` writes
`findings.status`, appends to `finding_history` and posts a
`classification_changed` event into the conversation in a single statement, so
the finding cannot change without the record of who changed it and why. The risk
workspace shows that history without offering a separate classification page.

On a database without migration `0025`, the client falls back to legacy
`classify_risk()`. The decision remains atomic, but no entry id is available for
a classification attachment. See the
[compatibility matrix](./frontend-integration.md#database-and-api-compatibility).

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
   → in the conversation composer, Developer adds "Request reassessment"
     (offered once an approach is selected, whatever the step progress)
     → ticket → retest_requested
   → in the same conversation, Security Team clicks "Run Retest"
     → automation API runs the test
     → result synced back → finding status updated → ticket → under_review
     → the conversation records the outcome
   → Security Team closes the ticket
```

Discussion, classification and reassessment all live in the conversation on
the assessment's risk page, never on the ticket — see
[the conversation](#the-conversation).

Completing every control step **does not** resolve the finding, and it is not
what makes a reassessment possible either. Progress is the developer's own
record of the work; the finding's status changes on a real reassessment result
or an explicit Security Team override.

### Authoritative transition matrix

The frontend computes the same availability for the remediation section and
the conversation composer in `src/lib/remediation-workflow.ts`. It uses stable
reason codes; `src/lib/remediation-workflow-messages.ts` is the only mapping
from those codes to user-facing explanations. Supabase remains authoritative
for permissions and persisted transitions.

| Current state / condition | Actor and ownership | Available action | Resulting state or event | Frontend check | Database enforcement |
| --- | --- | --- | --- | --- | --- |
| Finding needs work; no active remediation | developer assigned to the application's team | Start remediation | ticket `open`, `remediation_started` event, selected approach and progress rows | capability, application scope, live approach selection | ticket/application RLS and insert policies; the database does not know which controls the playbook currently offers |
| `open`, `in_progress`, `rejected` | owning developer | Select or replace approach | `selected_control_id` changes; old progress remains history | live active/required candidates, permission and state | `enforce_ticket_update_permissions`; it validates lifecycle and ownership, not playbook membership |
| editable remediation with a live selected approach | owning developer | Record step progress | step row status changes | live definition matched by stable control/step keys; missing/new steps are incomplete | progress RLS and ticket access |
| an approach selected, any step progress; earlier requests may be outstanding | owning developer | Request reassessment in the conversation | retest `queued`, ticket `retest_requested`, one `retest_requested` event | approach load/error/replacement, selection and capability checks — neither progress nor an outstanding request is consulted | `enforce_retest_request_permissions` rechecks ticket state and the selected approach; a unique index permits one *running* run per risk and deduplicates a retried submission |
| queued reassessment | — | no dashboard withdrawal; `withdraw_reassessment()` remains available to future callers | run `cancelled`, ticket restored to its recorded prior state, `retest_withdrawn` event | RPC verifies requester, access, run and ticket state | `withdraw_reassessment()` locks and verifies requester, access, run and ticket state |
| queued reassessment | security | Run reassessment | run `running`, ticket `retest_in_progress`, `retest_started` event | security capability and current run | `start_reassessment()` atomically claims only a queued request |
| automation result arrives | sync worker / security-owned processing | Reconcile result | run completes or fails; finding/ticket/events follow the result | progress display and polling only | sync idempotency keys and server-side writes |
| `under_review` or verification result | security | Close or request changes | ticket `closed`, or `rejected` plus conversation message | security capability | ticket update trigger/RLS reserve finalisation and security states for security |
| `open`, `in_progress`, `rejected` | owning developer | Withdraw remediation | ticket `withdrawn`, immutable reason/actor/time and event | capability and lifecycle | ticket trigger verifies type, source state, actor and reason |
| `withdrawn` | owning developer | Resume remediation | ticket `in_progress`; progress and history retained | capability and lifecycle | ticket trigger allows only the resume transition |
| historical `fix_submitted` | owning developer | select approach, withdraw, or request reassessment when otherwise ready | current transitions above; old event remains readable | explicit compatibility capability | migrations preserve the legal legacy state; no current UI creates it |

“Current steps” means rows matching the live playbook definition. An unavailable
or failed playbook response is unknown, not zero work. A removed stored approach
is replaced for display but cannot be called complete until its replacement is
reviewed and reconciled. Newly added steps start without completed rows. The
database deliberately cannot verify these live catalogue facts; it verifies the
persisted selection and progress while the frontend prevents misleading offers.

### Asking for a reassessment

There is no separate fix submission. The step checklist already says whether the
work is done, so a developer asks for a reassessment straight from an in-progress
remediation, and the request is offered only when all of these hold:

- a remediation ticket exists and is `open`, `in_progress` or `rejected`;
- an approach is selected and the playbook still offers it;
- its progress rows have been reconciled with the playbook's current steps;
- it has at least one step, and every one of them is completed;
- no reassessment is already queued or running;
- the developer holds `request_retest`.

Each of those has its own message when it does not hold, so the disabled control
always says what is missing. `enforce_retest_request_permissions` re-checks the
selected approach, its rows and their completion, so a client that skipped the
page cannot request one early.

`fix_submitted` remains a legal ticket status: remediations recorded before this
keep it and may still be reassessed, and old timelines still render the event.
Nothing puts a ticket into it any more.

Security can send work back at any point with **Request Changes**, which moves
the ticket to `rejected` and posts the reason into the conversation. The
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

Nothing is lost: the conversation, evidence, control progress and
activity survive, and resuming puts the ticket back to `in_progress` with all
of it intact and the withdrawal still on the record.

### Developer-facing status labels

The Resolve workspace renames every ticket status for a developer audience:

| Internal status | Displayed as |
|---|---|
| `open` | Action required |
| `in_progress` | In progress |
| `fix_submitted` | Fix submitted — historical only, see below |
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
| Read and post in a conversation | ✅ | ✅ |
| Upload evidence | ✅ | ✅ |
| Update control-step progress | ✅ | |
| Submit a fix | Historical state only; no current action | |
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
/resolve/applications/:applicationId/risks/:riskId      one feature-risk, with its conversation
/resolve/findings/:findingId/controls/:controlId        preview a control before starting
/resolve/tickets/:ticketId                             redirects to the risk page above
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
