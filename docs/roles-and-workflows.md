# Roles, Authentication & Workflows

## Roles & Capabilities

Four roles: `developer`, `security`, `cio`, `admin`. **A user can hold more
than one role at once** — `profiles.roles` is an array, not a single value.
All role-gated UI goes through a single capability model
(`src/auth/permissions.ts`) — components call `can("run_test")`, never
`profile.roles.includes("security")`; a capability is granted if *any* of
a user's roles grants it. Frontend checks are UX only; **Supabase RLS is
the real authorization boundary** (`supabase/migrations/0004_rls_policies.sql`,
`0006_storage.sql`, and the trigger functions in `0002_functions.sql`).

| Capability | developer | security | cio | admin |
|---|---|---|---|---|
| view_dashboard | ✅ | ✅ | ✅ | ✅ |
| view_findings / view_tickets | ✅ | ✅ | ✅ | |
| view_assessments | | ✅ | ✅ | |
| view_risk_conversation | ✅ | ✅ | ✅ | |
| view_resolve | ✅ | | | |
| create_ticket / request_retest / accept_risk | ✅ | | | |
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
[setup](./setup.md#role-assignment) for how initial
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
holds `developer`, whatever else it holds → /resolve
everyone else                           → /
```

`defaultRouteFor()` and `resolveAccess()` in `src/auth/permissions.ts` are pure
functions over the profile, so the routing rules are unit-tested rather than
inferred from component behaviour. Neither reads `primaryRole()`. A user who
holds both `developer` and `security` lands on `/resolve`, and still keeps every
security route *and* the Resolve workspace; `RoleHome` in `src/app.tsx` renders
the dashboard at `/` only for profiles that land there.

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

A control can be read in full without a ticket. The remediation approaches for a
risk are its **active, required** controls (`isRemediationControl()` in
`src/domain/remediation/resolve-rules.ts`). The risk page's remediation section
shows only the selected approach — the stored choice, or the first candidate
until one is stored. When there is more than one candidate, **View other
approaches** lists every candidate with its title, summary, step count and a
**Preview** link, and offers **Use this approach** on the ones not selected. The
**Exposed plaintext literals** card also links each item's control to the
preview. The preview shows the complete instructions, screenshots, references
and implementation example, with nothing writable, together with the playbook's
`active`, `deprecated` or `deprioritized` status and whether the control is a
remediation approach.

The current read-only preview is
`/resolve/findings/:findingId/controls/:controlId`.

Preview mode creates no `ticket_controls` or `ticket_control_steps` rows.
Steps cannot be ticked, notes cannot be added, and no reassessment can be
requested from it. The developer decides whether to start remediation only
after reading; stopping at the preview leaves no trace.

The preview sits inside `ResolveGuard`, like every `/resolve` route, so it needs
developer access rather than `view_findings`. The Assess test page's plaintext
literals card links there too; a reader without developer access who follows
that link sees "You do not have developer access". Whether progress can be
recorded is decided separately, by `update_control_progress`.

The selected approach's card covers the whole card, so a click anywhere on it
opens the control. Once a remediation ticket exists it is a link to the writable
control page. Before one exists it is a button: clicking it creates a
remediation ticket with that approach selected, then opens the writable page.

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
it. There are no standalone finding or ticket detail pages with separate
composers, and legacy finding and ticket URLs are no longer routed: like any
unknown path, the catch-all route redirects them to `/`. A ticket records the
conversation *and* the assessment it was opened against, and keeps both for
good, so a later run that moves the finding's own assessment reference on cannot
send the ticket somewhere else.

| Who | May |
|---|---|
| Security | read, post, change the classification; tests and reassessments are run from the risk's Assess test page, not from the conversation |
| Developer | read and post on their own team's applications, request a reassessment once the risk has a result |
| CIO | read |

A developer reaches the risk page for an application their team owns without
holding `view_assessments`: the route admits `view_risk_conversation` as well,
and RLS still decides what is visible, so an assessment outside their scope
comes back empty and the page says so. Reading a conversation grants nothing
else - a developer never gets test execution or classification.

Requesting a reassessment is not gated on the remediation workflow. A developer
holding `request_retest` may ask from the conversation once the risk has a
result; no ticket, approach or progress is required. If the request is linked to
a ticket, `enforce_retest_request_permissions` requires it to be a remediation
ticket opened against this risk, and a linked remediation ticket is reconciled
to `retest_requested`.

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
runs the reassessment and decides the classification from its result. The
trigger checks neither progress nor a selected approach.

Both actions live inside the conversation composer rather than as buttons above
the thread, and both are *additions* to an ordinary message rather than a
different way of writing one. They sit at the top of the composer, above the
message box: the offered actions first, then the selected action's chip and its
options, then the message box with Attach and Send, then the chosen file and any
submission feedback. That is the real DOM order, so keyboard focus follows what
the reader sees, and the row disappears entirely — leaving no gap — when a reader
is offered nothing. The message box, its placeholder, the attachment control and
the Send button never change; a permitted user adds **Change classification**,
**Request Reassessment**, **Accept Risk** or **Retract Acceptance** as a removable
chip, and Send then records that workflow step as well. Adding, swapping or removing a chip leaves the draft and any chosen
file untouched.

Classification uses the message as its required reason and refuses the
classification the risk already has. Accepting a risk and retracting an
acceptance also take the message as their required reason. A reassessment needs
no text, and anything typed is carried as context on the request event rather
than posted a second time.

A file can be attached in every case. It is stored against the entry the action
created — the `classification_changed`, `retest_requested`, `risk_accepted` or
`risk_acceptance_retracted` event, or the message itself — so a decision and its
evidence are one timeline item. `classify_risk_entry()` returns the entry id it wrote rather than leaving
the browser to search for it, which would race a concurrent classification of
the same risk.

Submission has one coordinator for messages, classifications, reassessment
requests, risk acceptance and its retraction. Its state is `idle → recording → attaching → complete`, and
`attaching` moves to `attachment_failed` when the file cannot be stored. A
failure in `recording` returns to `idle`, preserves the draft and may retry the
workflow operation. Once
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

Security does not run a reassessment from the conversation. For a reader with
`run_test`, the conversation lists the outstanding requests in queue order and
says to run the risk from its test page. There, **Run Automated Test** or **Run
Again** claims the oldest queued request through `start_reassessment()` before
the automated run starts.

**Reassessment withdrawal is work in progress and is not wired into the UI.**
The `withdraw_reassessment()` RPC (last changed by legacy fixes `0031` and
`0032`), its permissions and `retestData.withdraw()` exist but are intentionally
unused, so the dashboard offers no withdrawal control. Past `retest_withdrawn`
events still read in the feed.

When an action cannot be used it stays visible and says why, rather than
disappearing. A developer's reassessment offer is blocked only while no result
has been published for the risk ("No result has been published for this risk
yet, so there is nothing to reassess."); an outstanding request does not block
another. Security sees the same treatment on the classification control when no
result has been published for the risk yet. Any number of requests may be
queued, but only one may be running per risk, and that is enforced by the
database, not just by the UI.

### Classification versus severity

The **classification** is the finding's status - At Risk, Reduced Risk or
Inconclusive - and it is changed in the conversation, by security, with a
required reason. `classify_risk_entry()` writes
`findings.status`, appends to `finding_history` and posts a
`classification_changed` event into the conversation in a single statement, so
the finding cannot change without the record of who changed it and why. The risk
workspace shows that history without offering a separate classification page.

The frontend requires the schema through the latest fix. See the
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
   → opening the selected approach, or "Start remediation" on the preview,
     creates a remediation ticket (never edits the finding directly)
   → only the selected approach and its steps are initialised from the playbook
   → Developer works through the approach's steps, marking them complete
   → in the conversation composer, Developer adds "Request Reassessment"
     (offered once the risk has a result; no ticket, approach or progress needed)
     → a linked remediation ticket → retest_requested
   → on the risk's Assess test page, Security Team clicks "Run Automated Test"
     or "Run Again", which claims the oldest queued request
     → automation API runs the test
     → result synced back → finding status updated → ticket → under_review
     → the conversation records the outcome
   → closing the ticket is a database-only step; the dashboard has no control
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
the conversation composer in `src/domain/remediation/workflow.ts`. It uses stable
reason codes; `src/domain/remediation/workflow-messages.ts` is the only mapping
from those codes to user-facing explanations. Supabase remains authoritative
for permissions and persisted transitions.

| Current state / condition | Actor and ownership | Available action | Resulting state or event | Frontend check | Database enforcement |
| --- | --- | --- | --- | --- | --- |
| Finding needs work; no active remediation | developer assigned to the application's team | Start remediation | ticket `open`, `remediation_started` event, selected approach and progress rows | capability, application scope, live approach selection | ticket/application RLS and insert policies; the database does not know which controls the playbook currently offers |
| `open`, `in_progress`, `rejected` | owning developer | Select or replace approach | `selected_control_id` changes; old progress remains history | live active/required candidates, permission and state | `enforce_ticket_update_permissions`; it validates lifecycle and ownership, not playbook membership |
| editable remediation with a live selected approach | owning developer | Record step progress | step row status changes | live definition matched by stable control/step keys; missing/new steps are incomplete | progress RLS and ticket access |
| the risk has a result; no ticket, approach or progress needed; earlier requests may be outstanding | developer with `request_retest` on the owning team | Request Reassessment in the conversation | retest `queued`, one `retest_requested` event; a linked remediation ticket reconciles to `retest_requested` | conversation and result loaded, and the capability — neither a ticket, an approach, progress nor an outstanding request is consulted | `enforce_retest_request_permissions` requires a linked ticket to be a remediation ticket opened against this risk; a unique index permits one *running* run per risk, and another deduplicates a retried submission |
| the risk has an At Risk or Inconclusive result and no acceptance in force | developer with `accept_risk` on the owning team | **Accept Risk** in the conversation, with a reason | acceptance in force, `risk_acceptance` ticket `accepted`, `risk_accepted` event; every queued or running reassessment `cancelled` with a `retest_withdrawn` event; the open remediation `withdrawn` ("Risk accepted") with a `remediation_withdrawn` event | capability, result loaded and not Reduced Risk, acceptance state known | `accept_risk_entry()` verifies role, access, reason and result; one acceptance in force per risk; a retried submission resolves to the acceptance it made |
| acceptance in force | developer with `accept_risk` on the owning team | **Retract Acceptance** in the conversation, with a reason | acceptance ended as `retracted`, its ticket `withdrawn`, `risk_acceptance_retracted` event; reassessment and acceptance offered again | capability and an acceptance in force | `retract_risk_acceptance()` verifies role, access and reason; a retry resolves to the retraction already recorded |
| acceptance in force; a later result or reclassification makes the risk Reduced Risk | sync worker or security | none; it follows from the result | acceptance ended as `resolved`, its ticket `closed`, `risk_acceptance_ended` event | refreshes after sync and on new conversation entries | `trg_end_risk_acceptance_on_reduced_risk` on `finding_history`, at commit |
| acceptance in force | anyone | no reassessment request | refused | Request Reassessment is not offered | `enforce_retest_request_permissions` refuses a request on an accepted risk |
| queued reassessment | requester (work in progress, not wired into the UI) | no dashboard withdrawal; `withdraw_reassessment()` and `retestData.withdraw()` are intentionally unused | run `cancelled`, ticket restored to its recorded prior state once nothing else is outstanding, `retest_withdrawn` event | none | `withdraw_reassessment()` locks and verifies requester, reason, access, run and ticket state |
| queued reassessment | security | **Run Automated Test** / **Run Again** on the Assess test page | oldest queued request claimed: run `running`, ticket `retest_in_progress`, `retest_started` event | security capability; the page claims the oldest queued request only when none is running | `start_reassessment()` atomically claims only the oldest queued request, one running per risk |
| automation result arrives | sync worker / security-owned processing | Reconcile result | run completes or fails; finding/ticket/events follow the result | progress display and polling only | sync idempotency keys and server-side writes |
| `under_review` or verification result | security | Close or request changes (database only; no dashboard control) | ticket `closed`, or `rejected` plus conversation message | none; `close_ticket` and `request_changes` gate no control | ticket update trigger/RLS reserve finalisation and security states for security |
| `open`, `in_progress`, `rejected` | owning developer | Withdraw remediation | ticket `withdrawn`, immutable reason/actor/time and event | capability and lifecycle | ticket trigger verifies type, source state, actor and reason |
| `withdrawn` | owning developer | Resume remediation | ticket `in_progress`; progress and history retained | capability and lifecycle | ticket trigger allows only the resume transition |

“Current steps” means rows matching the live playbook definition. An unavailable
or failed playbook response is unknown, not zero work. A removed stored approach
is replaced for display but cannot be called complete until its replacement is
reviewed and reconciled. Newly added steps start without completed rows. The
database deliberately cannot verify these live catalogue facts; it verifies the
persisted selection and progress while the frontend prevents misleading offers.

### Asking for a reassessment

There is no separate fix submission. A developer holding `request_retest` asks
for a reassessment from the conversation composer, and the request is offered
once the risk has a result: the only block is "No result has been published for
this risk yet, so there is nothing to reassess." (`useRiskComposer()` in
`src/hooks/conversation/composer.ts`; `reassessmentBlockFor()` in
`src/domain/remediation/workflow.ts` checks only the capability). No remediation
ticket, selected approach or step progress is required, and any number of
requests may be queued; only one may be running per risk.

When the request is linked to a ticket, `enforce_retest_request_permissions`
requires it to be a remediation ticket opened against this risk. A linked
remediation ticket is then reconciled to `retest_requested`, unless it is
already `closed`, `accepted` or `withdrawn`.

`fix_submitted` is retired. Migration `0032` moved every ticket in that status
to `in_progress` and the database now rejects it; old timelines still render
the `fix_submitted` event.

The database still lets security move a remediation to `rejected` ("Changes
requested" to the developer), but the dashboard currently has no control for
it, nor for closing a ticket.

A finding has at most one remediation ticket in flight. On the control preview,
`WorkOnRiskButton` offers **Continue remediation** instead of creating a second
when one is already open, and **Resume remediation** when the last one was
withdrawn. The risk page itself offers **Resume remediation** and **Withdraw
remediation** in its remediation section.

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
`in_progress` or `rejected`. Once a reassessment has been
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
| Create a remediation ticket | ✅ | |
| Read and post in a conversation | ✅ | ✅ |
| Upload evidence | ✅ | ✅ |
| Update control-step progress | ✅ | |
| Submit a fix | Historical state only; no current action | |
| Request a reassessment | ✅ | |
| Accept a risk, or retract its acceptance | ✅ | |
| Withdraw or resume a remediation | ✅ | |
| Run a reassessment or retest | | ✅ |
| Request changes | | ✅ (database only; no dashboard control) |
| Change a risk's classification | | ✅ |
| Close a ticket | | ✅ (database only; no dashboard control) |
| Approve a requested risk acceptance | | ✅ (work in progress; not wired into the UI) |

Hiding a button is not authorization. The developer-only rows are UI capability
rules: RLS in `0004_rls_policies.sql` also lets security create remediation
tickets, write step progress and insert `retest_runs`, and
`enforce_ticket_update_permissions` applies its developer guards to neither
security nor admin. The security-only rows
are also enforced in the database: `findings_update`, `retest_runs_update` and
`risk_acceptance_update` require the `security` role, and `enforce_ticket_update_permissions`
(`0002_functions.sql`; `0035` restored its field guards) rejects a developer's attempt to set a ticket to
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
/resolve/tickets/:ticketId/controls/:controlId          one control's ordered steps, writable
```

Progress is reported with two formulas, both computed in `src/domain/remediation/resolve-rules.ts`:

```text
Application finding progress   resolved findings / total actionable findings
Control progress               completed selected-approach steps / total selected-approach steps
```

"Actionable" means `at_risk` or `reduced_risk`; `inconclusive` findings are
excluded because they are security's call, not developer work. Control progress
counts only the selected approach of each non-withdrawn remediation ticket,
restricted to controls and steps the live playbook still has (every stored row
counts while the backend is unreachable, rather than reporting zero);
alternatives and abandoned approaches stay history. Starting remediation initialises only the
selected approach and its steps (`src/hooks/remediation/ensure-remediation.ts`),
and the approach is always an **active, required** control — one the playbook
marks `deprioritized` or `deprecated` is never offered as one.

Withdrawn tickets are excluded from control progress and from the count awaiting
reassessment (`awaitingReassessment`), and are never counted as resolved. They
stay visible in the application's ticket list and carry their own count
(`withdrawnTickets`), so the history remains readable.

Application remediation progress is not test-execution progress. It says how far
the developers have got, not how far security has got through running tests.

## Risk Acceptance Workflow

A developer on the application's team (`accept_risk`) can accept a risk from
its conversation. **Accept Risk** sits beside **Request Reassessment** in the
composer and records the acceptance immediately; there is no security review.
The message is the required reason. Acceptance is a business decision recorded
beside the result: it never changes the finding's status, so an accepted risk
still reads **At Risk** or **Inconclusive**.

`accept_risk_entry()` does the whole step in one transaction:

- records the acceptance (`risk_acceptance`, `decision = 'accepted'`) with the
  result it accepted (`accepted_run_id`, `accepted_status`) and a
  `risk_acceptance` ticket in `accepted`;
- posts a **Risk accepted** event carrying the reason;
- cancels every queued or running reassessment of the risk, posting a
  **Reassessment withdrawn** event for each ("Cancelled because the risk was
  accepted."). A running automation run still finishes and its result still
  syncs; only the request is cancelled;
- withdraws the risk's open remediation (`open`, `in_progress` or `rejected`,
  including one just released from a cancelled reassessment) with the reason
  "Risk accepted", posting a **Remediation withdrawn** event. A remediation
  under security review is left to security.

While the acceptance is in force, **Request Reassessment** and **Accept Risk**
are not offered and **Retract Acceptance** is. The risk header and its sidebar
entry read **Risk accepted** instead of the remediation's status, and the
Resolve applications list no longer counts the risk as needing action; an app
whose remaining risks are all accepted reads **Risk accepted**.

Remediation is paused, not hidden. The remediation section still shows the
selected approach, its steps and the progress recorded, with the note "This risk
is accepted, so remediation is paused. Retract the acceptance in the
conversation to resume remediation." Steps open read-only, the approach cannot
be changed, opening a control does not start a remediation, and **Resume
remediation** and **Withdraw remediation** are not offered. These are interface
rules; the database still allows step progress on a withdrawn remediation, as it
did before. The database refuses any new
reassessment request for the risk, whoever sends it. Accept Risk is blocked,
with its reason shown, when the risk has no result yet, when its result is
already Reduced Risk, or when the dashboard cannot tell whether an acceptance is
already in force.

An acceptance ends in one of two ways, and stays on the record either way:

| Ending | Trigger | Ticket | Conversation |
| --- | --- | --- | --- |
| `retracted` | any developer on the team uses **Retract Acceptance**, with a reason | `withdrawn` | **Risk acceptance retracted**, with the reason |
| `resolved` | a later automation result, or a security reclassification, makes the risk Reduced Risk | `closed` | **Risk acceptance ended: the risk is now Reduced Risk** |

Retracting leaves the remediation withdrawn; the developer chooses whether to
use **Resume remediation**, which carries on with its progress intact. A later
result that is still At Risk or Inconclusive leaves the acceptance in force. Once ended, an acceptance never comes back: if the risk later reads At
Risk again, a developer accepts it again. Acceptances have no expiry.

The earlier request-and-review design is **work in progress and not wired into
the UI**: `AcceptRiskButton` and `ReviewRiskAcceptanceDialog` in
`src/components/remediation/risk-acceptance.tsx` and the `createTicket` and
`review` data functions are intentionally unused. Clients can still insert only
a `pending` request; an accepted row is written only by `accept_risk_entry()`.

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

The iOS and Android builds of an app are separate applications with their own
assessments, so the assessments list shows one row for each, labelled with its
platform and sorted next to each other. The application filter and the row
actions name the platform too.

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
Security Team clicks "New Assessment" on the Assessments page
   → fills in /assessments/new and clicks "Confirm & Create Assessment"
   → registers the app with the backend, then the application and a `queued`
     assessment in the dashboard
   → queues a run request (request_assessment_run), which the backend's
     assessment worker claims
   → only if the backend knows the app and does not report its provisioning
     status as `ready`, opens an app_provisioning ticket (no finding yet —
     none exists)
   → Security downloads the app onto a device (+ registers it under the
     test Apple ID, for iOS)
```

`app_provisioning` is the one ticket type not created from a finding —
`tickets.finding_id` is nullable specifically for it
(`supabase/migrations/0001_extensions_and_tables.sql`). The ticket is only
opened by `addApp()` in `src/workflows/app-registration.ts`, and the dashboard
has no control for closing it. Readiness comes from the backend's
`GET /config/{platform}/apps/{app_id}/provisioning`; the provisioning ticket is
only the fallback signal, used when the backend returns no provisioning state
for the app (`src/components/assessment/assessment-progress.tsx`). What is
actually runnable is governed by the automation backend, not this dashboard's
database.
