Build a complete standalone frontend dashboard for my mobile application security assessment platform.

The existing backend API already supports automated security testing and exists at /Users/user/playbook/mobile_playbook_automation 

Your task is to build the dashboard application around that existing automation API.

The dashboard must:

- Be a separate project from the automation backend.
- Use the existing API for automated security testing.
- Use **Supabase** for persistent dashboard data, authentication, users, roles, findings, tickets, messages, and workflow information.
- Contain no mock data.
- Support multiple users with different roles.
- Be easy to configure and deploy.
- Keep components and responsibilities decoupled while avoiding unnecessary file proliferation.

Do not redesign or replace the existing automation backend.

---

# 1. Overall Architecture

Use this architecture:

```text
┌──────────────────────────────────┐
│        Dashboard Frontend        │
│                                  │
│ React + TypeScript               │
│ Role-aware UI                    │
│ Assessment / Findings / Tickets  │
└──────────────┬───────────────────┘
               │
       ┌───────┴──────────┐
       │                  │
       ▼                  ▼
┌─────────────────┐  ┌────────────────────────┐
│    Supabase     │  │ Existing Automation API│
│                 │  │                        │
│ PostgreSQL      │  │ iOS Testing            │
│ Authentication  │  │ Android Testing        │
│ Users / Roles   │  │ Test Execution         │
│ Findings        │  │ Test Results           │
│ Tickets         │  │ Automation Evidence    │
│ Messages        │  │ Job Status             │
└─────────────────┘  └────────────────────────┘
```

The existing automation API and Supabase must remain separate systems.

Do not attempt to merge Supabase into the automation backend.

---

# 2. Technology Stack

Use:

- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui where useful
- Lucide icons
- React Router
- TanStack Query / React Query
- Supabase JavaScript client
- Axios or a clean fetch wrapper for the automation API

Use current stable versions where possible.

Avoid unnecessary dependencies.

The project should run using:

```bash
npm install
npm run dev
```

and build using:

```bash
npm run build
```

---

# 3. Environment Configuration

Create:

```text
.env.example
```

with:

```env
VITE_API_BASE_URL=http://localhost:8000

VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

VITE_APP_NAME=Mobile Application Security Assessment
```

Do not hard-code environment-specific addresses.

Do not expose:

```text
SUPABASE_SERVICE_ROLE_KEY
```

inside browser/frontend environment variables.

The service-role key must never be shipped to the browser.

---

# 4. Main Navigation

Use:

```text
Dashboard
Assessment
Findings
Tickets
```

Optionally:

```text
Settings
```

Do not include:

```text
Learn
```

Do not include frontend assessment creation.

---

# 5. Visual Design

Create a clean enterprise application-security dashboard.

Use:

- White/light-grey backgrounds
- Blue primary accent
- Dark navy/black text
- Thin borders
- Subtle shadows
- Rounded cards
- Clear typography hierarchy
- Compact tables
- Clear status badges
- Consistent spacing
- Minimal visual clutter
- Professional cybersecurity/product aesthetic

Avoid:

- excessive gradients
- colourful generic admin templates
- oversized illustrations
- unnecessary decorative charts

Desktop is the primary target.

Optimise primarily for around:

```text
1440px desktop
```

while supporting tablet and smaller layouts reasonably.

---

# 6. Roles

Support at least:

```text
Developer Team
Security Team
CIO
```

Represent them internally as:

```typescript
type UserRole =
  | "developer"
  | "security"
  | "cio";
```

Do not scatter role-specific checks throughout JSX.

Use a central capability model.

Example:

```typescript
type Capability =
  | "view_dashboard"
  | "view_assessments"
  | "view_findings"
  | "view_tickets"
  | "create_ticket"
  | "comment_ticket"
  | "submit_fix"
  | "request_retest"
  | "run_test"
  | "update_finding"
  | "review_risk_acceptance"
  | "close_ticket"
  | "view_executive_metrics";
```

---

# 7. Role Capabilities

Centralise role/capability mapping.

Conceptually:

```typescript
const roleCapabilities: Record<UserRole, Capability[]> = {
  developer: [
    "view_dashboard",
    "view_findings",
    "view_tickets",
    "create_ticket",
    "comment_ticket",
    "submit_fix",
    "request_retest",
  ],

  security: [
    "view_dashboard",
    "view_assessments",
    "view_findings",
    "view_tickets",
    "comment_ticket",
    "run_test",
    "update_finding",
    "review_risk_acceptance",
    "close_ticket",
  ],

  cio: [
    "view_dashboard",
    "view_assessments",
    "view_findings",
    "view_tickets",
    "view_executive_metrics",
  ],
};
```

These are UI capabilities.

Backend/database security must still enforce actual authorization.

Prefer capability checks such as:

```typescript
can("run_test")
```

rather than repeated code such as:

```typescript
user.role === "security"
```

---

# 8. Authentication

Use **Supabase Auth** for dashboard users unless there is already another suitable authentication system.

The dashboard should support login/logout.

Use Supabase Auth identity with a separate `profiles` table for application-specific user information.

Conceptually:

```text
auth.users
    │
    │ 1:1
    ▼
profiles
```

Recommended profile structure:

```sql
profiles
--------
id UUID PRIMARY KEY
display_name TEXT
email TEXT
role TEXT
team_id UUID NULL
is_active BOOLEAN
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

`profiles.id` should correspond to the Supabase Auth user ID.

Supported roles:

```text
developer
security
cio
```

Do not allow normal users to change their own role.

---

# 9. Teams

Support teams.

Recommended table:

```sql
teams
-----
id UUID PRIMARY KEY
name TEXT
type TEXT
created_at TIMESTAMPTZ
```

Possible team types:

```text
developer
security
management
```

Then:

```text
profiles.team_id → teams.id
```

A development team may have multiple users.

This should allow findings and tickets to be associated with a team rather than only a single individual.

---

# 10. Data Ownership

There are two distinct data sources.

## Existing Automation API

Source of truth for:

```text
iOS automated tests
Android automated tests
Automation jobs
Automation execution state
Raw automation results
Raw automation output
Automation-generated evidence
```

## Supabase

Source of truth for dashboard/workflow data:

```text
Users
Roles
Teams
Applications
Assessment metadata
Findings
Finding history
Tickets
Ticket messages
Ticket attachments
Risk acceptance
Retest workflow
Activity history
Dashboard relationships
```

Do not create two competing sources of truth for the same responsibility.

---

# 11. Frontend State

Persistent application data must NOT live primarily in the browser.

Supabase should persist:

```text
Users
Roles
Teams
Applications
Assessments
Findings
Finding history
Tickets
Messages
Evidence metadata
Retest requests
Risk acceptance
Activity history
```

Frontend-only temporary state can include:

```text
Current filters
Search query
Pagination
Open dialog/modal
Temporary unsent form values
React Query cache
Expanded/collapsed UI sections
```

Avoid storing sensitive findings/tickets/evidence in:

```text
localStorage
sessionStorage
IndexedDB
```

unless clearly required.

---

# 12. Finding Categories

Findings must use exactly these three categories:

```text
At Risk
Reduced Risk
Inconclusive
```

Represent them as:

```typescript
type FindingStatus =
  | "at_risk"
  | "reduced_risk"
  | "inconclusive";
```

Display:

```text
at_risk       → At Risk
reduced_risk  → Reduced Risk
inconclusive  → Inconclusive
```

Suggested colours:

```text
At Risk        → red
Reduced Risk   → green
Inconclusive   → amber
```

Keep the mapping centralised.

Do not use:

```text
Resolved
Passed
Failed
Risk Reduced
```

as top-level finding categories.

---

# 13. Test Status vs Finding Status

Keep automated execution state separate from finding state.

Example execution status:

```typescript
type TestRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";
```

A test may be:

```text
Completed
```

while its finding is:

```text
At Risk
```

These are different concepts.

Do not mix them in the UI or data model.

---

# 14. Applications

Store application metadata required by the dashboard in Supabase.

Recommended conceptual table:

```sql
applications
------------
id UUID PRIMARY KEY
external_id TEXT NULL
name TEXT
platform TEXT
version TEXT
identifier TEXT NULL
developer_team_id UUID NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Platform values:

```text
ios
android
```

`external_id` can link the application to the existing automation API.

---

# 15. Assessments

Assessments are created by the existing backend.

The dashboard must NOT create assessments.

Do not implement:

```text
New Assessment
Create Assessment
Delete Assessment
/assessments/new
```

Assessment data should be retrieved from the existing automation API.

Relevant metadata may also be synchronised into Supabase to link it with findings and tickets.

Conceptual Supabase table:

```sql
assessments
-----------
id UUID PRIMARY KEY
external_id TEXT UNIQUE
application_id UUID
status TEXT
total_tests INTEGER
completed_tests INTEGER
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Supabase should not create the actual automation assessment.

---

# 16. Assessment Page

Navigation:

```text
Assessment
```

Route:

```text
/assessments
```

Page heading:

```text
Assessments
```

Display backend-created assessments.

Suggested columns:

```text
Application
Version
Platform
Progress
Status
Updated
```

Example structure:

```text
ABC Banking     3.2.1     Android     5 / 8     In Progress
XYZ Wallet      2.4.0     iOS         8 / 8     Completed
```

Do not add:

```text
+ New Assessment
```

---

# 17. Assessment Visibility

## Security Team

Can:

```text
View assessments
Open assessments
View available tests
Run allowed automated tests
Inspect test results
```

## CIO

Can:

```text
View assessment status
View application coverage
View associated findings
```

Prefer read-only interaction.

## Developer Team

Do not expose the Assessment section by default.

Developers should primarily work through:

```text
Findings
Tickets
```

Related assessment/application metadata may be displayed on finding pages.

---

# 18. Assessment Details

Display:

```text
Application
Version
Platform
Assessment Status
Progress
Created
Updated
```

Below this, display security tests returned by the existing API.

Do not hard-code a fixed iOS/Android testing catalogue.

Example UI:

```text
Security Tests

Screen Capture                At Risk
Runtime Instrumentation       Reduced Risk
Network Interception          At Risk
Application Tampering         Inconclusive
Sensitive Logging             Not Tested
```

Use backend-provided test names.

---

# 19. Automated Test Workspace

Only users with:

```text
run_test
```

should see automated test controls.

Normally this is the Security Team.

Display:

```text
Test Name
Platform
Description
Latest Result
Last Run
```

Action:

```text
Run Automated Test
```

Use the existing automation backend.

Possible lifecycle:

```text
Queued
  ↓
Running
  ↓
Completed
```

or:

```text
Failed
```

Do not fabricate progress percentages unless the backend provides them.

---

# 20. Test Run History

Support multiple automated runs.

Do not overwrite previous results.

Display something like:

```text
26 Aug 2026 13:30    Completed    At Risk
24 Aug 2026 11:15    Completed    At Risk
20 Aug 2026 09:40    Completed    Inconclusive
```

Allow each run to expose, where available:

```text
Started
Completed
Duration
Execution Status
Finding Result
Output
Evidence
Errors
```

---

# 21. Automation Result Synchronisation

Do not assume the existing backend writes to Supabase.

Create a central integration flow.

Example:

```text
Security Team runs automated test
          ↓
Dashboard calls Automation API
          ↓
Automation executes
          ↓
Result returned / retrieved
          ↓
Frontend integration service maps result
          ↓
Relevant finding metadata persisted in Supabase
          ↓
Dashboard refreshes
```

This integration logic must be centralised.

Do not repeat result-to-Supabase persistence logic in multiple pages.

Use stable external IDs where possible to prevent duplicates.

---

# 22. Findings

Findings are a core dashboard entity.

Store them in Supabase.

Recommended conceptual schema:

```sql
findings
--------
id UUID PRIMARY KEY
external_id TEXT NULL

application_id UUID
assessment_id UUID NULL

test_id TEXT NULL
latest_test_run_id TEXT NULL

title TEXT
description TEXT NULL
impact TEXT NULL

severity TEXT NULL
status TEXT NOT NULL

platform TEXT

created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Status must be:

```text
at_risk
reduced_risk
inconclusive
```

---

# 23. Finding History

Do not silently overwrite status history.

Recommended:

```sql
finding_history
---------------
id UUID PRIMARY KEY
finding_id UUID
previous_status TEXT NULL
new_status TEXT
changed_by UUID NULL
reason TEXT NULL
created_at TIMESTAMPTZ
```

Example:

```text
At Risk
   ↓
Remediation
   ↓
Retest
   ↓
Reduced Risk
```

---

# 24. Findings Page

Route:

```text
/findings
```

Provide tabs/filters:

```text
All
At Risk
Reduced Risk
Inconclusive
```

Additional filters:

```text
Application
Platform
Severity
Finding Type
Date
```

Provide search.

Each finding row/card should show:

```text
Finding
Application
Version
Platform
Severity
Status
Date Found
Finding ID
Ticket Status
```

---

# 25. Developer Team Access

Developer Team users should primarily see findings relevant to their team/applications.

They may:

```text
View findings
View finding details
View evidence
View impact
View remediation guidance
View related tickets
Create tickets
Comment on tickets
Upload evidence through tickets
Submit fix information
Request retest
Request risk acceptance
```

They should NOT normally:

```text
Run automated tests
Create assessments
Directly change finding status
Delete findings
Modify assessment data
```

---

# 26. Developer Finding Workflow

Each At Risk/Inconclusive finding should provide clear developer actions such as:

```text
[ Work on this Risk ]
[ Accept Risk ]
```

These actions must create tickets.

Do not directly modify the finding.

Example:

```text
Screen Capture Exposure

Status: At Risk
Severity: High

[ Work on this Risk ]
[ Accept Risk ]
```

---

# 27. Tickets

Add:

```text
Tickets
```

to the main navigation.

Route:

```text
/tickets
```

Tickets are the central collaboration mechanism between Developer Team and Security Team.

Use Supabase to persist them.

Support at least these ticket types:

```typescript
type TicketType =
  | "remediation"
  | "risk_acceptance"
  | "retest_request";
```

---

# 28. Remediation Tickets

Selecting:

```text
Work on this Risk
```

should create a remediation ticket.

Recommended fields:

```text
Title
Finding
Developer Notes
Planned Fix
Target Version
Optional Evidence
```

The ticket must link to the associated finding and application.

---

# 29. Risk Acceptance Tickets

Selecting:

```text
Accept Risk
```

should create a risk-acceptance ticket.

Do not directly set the finding to Reduced Risk.

Capture information such as:

```text
Reason for accepting risk
Business justification
Compensating controls
Requested expiry/duration if applicable
Additional comments
Supporting evidence
```

Security Team should be able to review the request.

Risk acceptance is a business/workflow decision.

It must remain separate from the technical finding status.

---

# 30. Retest Requests

Developers must request retesting through tickets.

Preferred flow:

```text
Developer opens remediation ticket
        ↓
Implements fix
        ↓
Adds fix/version information
        ↓
Adds optional evidence
        ↓
Clicks Request Retest
        ↓
Ticket becomes Retest Requested
        ↓
Security Team sees request
        ↓
Security Team runs automation
        ↓
Result linked back to ticket/finding
```

A separate retest-request ticket may also be supported if appropriate, but reuse the remediation ticket where practical.

---

# 31. Ticket Status

Keep ticket status separate from finding status.

Possible statuses:

```typescript
type TicketStatus =
  | "open"
  | "in_progress"
  | "fix_submitted"
  | "retest_requested"
  | "retest_in_progress"
  | "under_review"
  | "accepted"
  | "rejected"
  | "closed";
```

The actual final values should match the implementation.

---

# 32. Ticket Storage

Recommended conceptual table:

```sql
tickets
-------
id UUID PRIMARY KEY

finding_id UUID
application_id UUID

type TEXT
status TEXT

title TEXT
description TEXT NULL

created_by UUID
assigned_user_id UUID NULL
assigned_team_id UUID NULL

target_version TEXT NULL

created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
closed_at TIMESTAMPTZ NULL
```

A finding may have multiple tickets.

Example:

```text
Finding FND-1001
   │
   ├── TKT-102 Remediation
   ├── TKT-118 Retest Request
   └── TKT-144 Risk Acceptance
```

---

# 33. Ticket Messages

Multiple users must be able to discuss a ticket.

Use Supabase to persist ticket messages.

Recommended:

```sql
ticket_messages
---------------
id UUID PRIMARY KEY
ticket_id UUID
author_id UUID
message TEXT
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ NULL
```

Messages should display chronologically.

Example:

```text
Developer
Implemented a mitigation in version 3.2.2.

Security Team
Please provide evidence and request a retest.

Developer
Evidence uploaded. Retest requested.
```

Do not keep authoritative message history only in React state.

---

# 34. Ticket Attachments

Allow messages/tickets to contain evidence.

Use Supabase Storage where appropriate.

Recommended metadata table:

```sql
ticket_attachments
------------------
id UUID PRIMARY KEY
ticket_id UUID
message_id UUID NULL
uploaded_by UUID
storage_path TEXT
file_name TEXT
mime_type TEXT NULL
created_at TIMESTAMPTZ
```

Possible uploads:

```text
Screenshots
Logs
JSON files
Text files
Reports
Images
Fix evidence
```

Do not store large binary files directly in standard PostgreSQL columns unless necessary.

---

# 35. Realtime Messages

Where practical, use Supabase Realtime for ticket messages.

Example:

```text
Developer sends message
        ↓
Supabase
        ↓
Security Team's open ticket updates
```

Keep realtime subscription logic centralised.

If realtime introduces unnecessary complexity for the first version, React Query refetch/invalidation is acceptable.

---

# 36. Ticket Page

Display tickets in a table/list.

Suggested columns:

```text
Ticket ID
Type
Finding
Application
Status
Created By
Assigned To
Updated
```

Filters:

```text
Type
Status
Application
Assignee
Created By
```

---

# 37. Developer Ticket View

Prioritise:

```text
Open Tickets
Remediation Tickets
Risk Acceptance
Retest Requested
Awaiting Security Team
Closed Tickets
```

Actions where relevant:

```text
Add Message
Add Evidence
Update Fix Information
Submit Fix
Request Retest
```

---

# 38. Security Team Ticket View

Prioritise:

```text
Open Remediation Tickets
Risk Acceptance Requests
Retest Requests
Awaiting Security Review
```

Possible actions:

```text
Comment
Review Evidence
Review Risk Acceptance
Accept/Reject Risk Acceptance
Run Retest
Record Retest Result
Update Finding
Close Ticket
```

Only expose actions supported by actual permissions/workflow.

---

# 39. CIO Ticket View

Primarily read-only.

Show:

```text
Open Remediation
Retest Pending
Risk Acceptance Pending
Accepted Risks
Overdue Tickets
```

Do not expose detailed operational controls unless authorised.

---

# 40. Finding Detail

Display:

```text
Finding Name
Application
Version
Platform
Severity
Status
Finding ID
Date Found
```

Sections:

```text
Description
Impact
Evidence
Remediation Guidance
Test History
Related Tickets
Activity
```

Developer Team should see ticket actions prominently.

Security Team should see review/testing actions.

CIO should see a simplified executive-oriented presentation.

Reuse the same underlying components.

Do not build three separate finding systems.

---

# 41. Evidence

Evidence may originate from:

```text
Automation backend
Developer
Security Team
```

Recommended metadata model:

```sql
evidence
--------
id UUID PRIMARY KEY

finding_id UUID NULL
ticket_id UUID NULL
test_run_id TEXT NULL

type TEXT
name TEXT
source TEXT

storage_path TEXT NULL
external_url TEXT NULL
text_content TEXT NULL

created_by UUID NULL
created_at TIMESTAMPTZ
```

Possible evidence types:

```text
image
text
log
json
file
report
```

Use Supabase Storage for uploaded dashboard files.

Automation evidence may remain at the backend and be referenced using URLs/IDs.

Avoid unnecessary duplication.

---

# 42. Retest Records

Persist dashboard retest workflow information.

Recommended conceptual model:

```sql
retest_runs
-----------
id UUID PRIMARY KEY
ticket_id UUID
finding_id UUID
external_test_run_id TEXT
requested_by UUID
executed_by UUID NULL
status TEXT
result TEXT NULL
created_at TIMESTAMPTZ
completed_at TIMESTAMPTZ NULL
```

The actual automation test should still run through the existing backend API.

---

# 43. Risk Acceptance Storage

Recommended conceptual table:

```sql
risk_acceptance
---------------
id UUID PRIMARY KEY
ticket_id UUID
finding_id UUID
requested_by UUID

reason TEXT
business_justification TEXT NULL
compensating_controls TEXT NULL
expires_at TIMESTAMPTZ NULL

reviewed_by UUID NULL
decision TEXT NULL
review_comment TEXT NULL

created_at TIMESTAMPTZ
reviewed_at TIMESTAMPTZ NULL
```

Possible decision values:

```text
pending
accepted
rejected
```

Do not automatically map:

```text
accepted → Reduced Risk
```

The finding's technical state and risk acceptance are distinct.

---

# 44. Activity History

Create a reusable activity/audit history.

Recommended table:

```sql
activity_log
------------
id UUID PRIMARY KEY
actor_id UUID NULL

entity_type TEXT
entity_id UUID

action TEXT
metadata JSONB NULL

created_at TIMESTAMPTZ
```

Possible actions:

```text
finding_created
finding_status_changed

ticket_created
ticket_updated
message_added
evidence_added

fix_submitted
retest_requested
retest_started
retest_completed

risk_acceptance_requested
risk_acceptance_accepted
risk_acceptance_rejected
```

Use one reusable timeline component to display activity.

---

# 45. Dashboard

The Dashboard should adapt by role while reusing underlying components.

---

# 46. Developer Team Dashboard

Prioritise:

```text
At Risk Findings
Reduced Risk Findings
Inconclusive Findings
Open Tickets
Fixes In Progress
Retest Requested
Awaiting Security Team
```

Useful sections:

```text
Findings requiring action
Recent ticket activity
Retests awaiting security
Recently updated findings
```

---

# 47. Security Team Dashboard

Prioritise:

```text
Applications
Assessments
Active Tests
Tests Running
Tests Failed
At Risk Findings
Reduced Risk Findings
Inconclusive Findings
Retest Requests
Open Tickets
Risk Acceptance Requests
```

Useful sections:

```text
Active assessments
Recent automation runs
Failed runs
Recent findings
Developer retest requests
Risk acceptance reviews
```

---

# 48. CIO Dashboard

Prioritise:

```text
Applications Assessed
Assessment Coverage
At Risk Findings
Reduced Risk Findings
Inconclusive Findings
Critical Findings
High Findings
Open Remediation
Retest Pending
Accepted Risks
```

Useful sections:

### Security Posture

```text
At Risk
Reduced Risk
Inconclusive
```

### Highest Risk Applications

Example:

```text
Application          Critical   High   Medium
ABC Banking               2       5       3
XYZ Wallet                0       4       2
DEF Payments              1       2       6
```

### Outstanding Work

```text
Open remediation tickets
Retests pending
Risk acceptance pending
Accepted risks
```

CIO should primarily be read-only.

---

# 49. Supabase Row Level Security

Enable Row Level Security.

Do not rely only on frontend capability checks.

## Developer Team

Should be able to:

```text
Read findings related to their team/applications
Read relevant tickets
Create remediation tickets
Create risk-acceptance tickets
Add ticket messages
Add ticket evidence
Request retests
```

Should not be able to:

```text
Change finding status directly
Modify user roles
Approve their own risk acceptance
Read unrelated teams' restricted workflow data
```

## Security Team

Should be able to:

```text
Read assessments
Read all findings
Read relevant tickets
Respond to tickets
Review risk acceptance
Process retests
Update security workflow records
```

## CIO

Should primarily be allowed to:

```text
Read dashboard metrics
Read findings
Read assessment summaries
Read ticket/remediation state
Read risk-acceptance state
```

Avoid routine write permissions.

Implement precise RLS based on the final schema.

---

# 50. Role Security

Never trust a role passed from the browser.

Do not allow:

```text
Developer → update profile role → security
```

Role changes should require trusted/admin-level operations.

Document how initial roles are assigned.

---

# 51. Supabase Database Setup

Include database setup with the frontend project.

Prefer:

```text
supabase/
└── migrations/
```

or a documented SQL schema if migrations are not practical.

Include:

```text
Tables
Foreign keys
Indexes
Constraints
RLS policies
Storage buckets
Storage policies
Role setup
Required Supabase Auth setup
```

The project should be reproducible against a new Supabase project.

---

# 52. Database Relationships

Use relationships conceptually like:

```text
Supabase Auth User
       │
       ▼
    Profile
       │
       ▼
      Team


Application
    │
    ├── Assessments
    │
    └── Findings
           │
           ├── Finding History
           │
           ├── Evidence
           │
           └── Tickets
                  │
                  ├── Messages
                  ├── Attachments
                  ├── Retest Runs
                  └── Risk Acceptance
```

Use foreign keys where appropriate.

---

# 53. API Layer

Keep automation API communication separate from Supabase access.

Recommended compact structure:

```text
src/
├── api/
│   ├── automation-client.ts
│   ├── automation-services.ts
│   └── automation-types.ts
│
├── data/
│   ├── supabase.ts
│   ├── services.ts
│   └── types.ts
```

Do not scatter:

```typescript
fetch(...)
```

or:

```typescript
supabase.from(...)
```

through page components.

---

# 54. Automation Services

Use grouped automation services such as:

```typescript
export const assessmentApi = { ... };
export const testApi = { ... };
```

Handle:

```text
List assessments
Get assessment details
List tests
Run automated test
Get test-run status
Get test result
Get automation evidence
```

Use actual existing backend endpoints after inspecting the API.

Do not invent duplicate API endpoints if equivalents exist.

---

# 55. Supabase Services

Create grouped data services.

Example:

```typescript
export const userData = { ... };
export const findingData = { ... };
export const ticketData = { ... };
export const messageData = { ... };
```

Use them for:

```text
Current user/profile
Findings
Finding history
Tickets
Messages
Attachments
Risk acceptance
Retest records
Activity
```

---

# 56. Recommended Project Structure

Keep it decoupled but compact.

Use approximately:

```text
src/
├── api/
│   ├── automation-client.ts
│   ├── automation-services.ts
│   └── automation-types.ts
│
├── data/
│   ├── supabase.ts
│   ├── services.ts
│   └── types.ts
│
├── auth/
│   ├── AuthProvider.tsx
│   └── permissions.ts
│
├── components/
│   ├── common.tsx
│   ├── data-display.tsx
│   ├── evidence.tsx
│   └── timeline.tsx
│
├── pages/
│   ├── Dashboard.tsx
│   ├── Assessments.tsx
│   ├── AssessmentDetail.tsx
│   ├── TestDetail.tsx
│   ├── Findings.tsx
│   ├── FindingDetail.tsx
│   ├── Tickets.tsx
│   ├── TicketDetail.tsx
│   └── Settings.tsx
│
├── hooks/
│   └── queries.ts
│
├── lib/
│   ├── status.ts
│   └── utils.ts
│
├── App.tsx
└── main.tsx
```

Guiding principle:

```text
Decouple by responsibility,
but group closely related logic together.
```

Do not create a separate file for every function, API request, or small component.

Do not turn one file into thousands of lines either.

Split only when complexity justifies it.

---

# 57. Reusable Components

Create reusable components for repeated visual patterns.

Examples:

```text
PageHeader
StatCard
StatusBadge
SeverityBadge
PlatformBadge
ProgressBar
DataTable
FilterBar
SearchInput
EmptyState
ErrorState
LoadingState
EvidenceViewer
Timeline
TicketBadge
TicketActions
```

Avoid role-specific duplicates like:

```text
DeveloperFindingCard
SecurityFindingCard
CioFindingCard
```

Prefer one component whose visible information/actions are determined by capability.

---

# 58. Queries

Keep data-fetching hooks reasonably compact.

For example:

```text
hooks/queries.ts
```

may contain:

```typescript
useCurrentUser()
useAssessments()
useAssessment()
useTests()
useTestRun()
useFindings()
useFinding()
useTickets()
useTicket()
useTicketMessages()
useDashboardMetrics()
```

Only split the file if it genuinely becomes difficult to maintain.

---

# 59. Finding Status Configuration

Centralise status configuration.

For example:

```typescript
export const findingStatusConfig = {
  at_risk: {
    label: "At Risk",
    tone: "danger",
  },

  reduced_risk: {
    label: "Reduced Risk",
    tone: "success",
  },

  inconclusive: {
    label: "Inconclusive",
    tone: "warning",
  },
};
```

Do not redefine colours/labels in multiple pages.

---

# 60. Main Routes

Use:

```text
/

/assessments

/assessments/:assessmentId

/assessments/:assessmentId/tests/:testId

/assessments/:assessmentId/tests/:testId/runs/:runId

/findings

/findings/:findingId

/tickets

/tickets/:ticketId

/settings
```

Do not create:

```text
/assessments/new
/learn
```

---

# 61. Filters

Assessment filters:

```text
Application
Platform
Status
```

Finding filters:

```text
Application
Platform
Severity
Status
Finding Type
```

Ticket filters:

```text
Type
Status
Application
Assigned Team
Created By
```

Where practical, keep filter state in URL query parameters.

Example:

```text
/findings?status=at_risk&platform=ios
```

---

# 62. Empty States

Do not implement mock data.

The dashboard must work correctly with:

```text
0 users except initial admin/setup user
0 assessments
0 findings
0 tickets
0 messages
```

Examples:

```text
No assessments are currently available.
```

```text
No findings have been recorded yet.
```

```text
No tickets yet.
```

The UI should remain polished when empty.

---

# 63. Loading/Error States

Every API/database page must support:

```text
Loading
Empty
Error
Success
```

Example:

```text
Unable to load findings.

Please try again.

[Retry]
```

Do not replace failures with fake data.

---

# 64. Existing Automation API Inspection

When I provide the backend/API code or documentation, inspect it before significant integration work.

Determine:

```text
Authentication requirements
Assessment endpoints
Assessment models
Test definitions
Test execution endpoints
Job lifecycle
Test-run IDs
Result structure
Evidence structure
Error structure
iOS/Android differences
```

Build the dashboard adapter around the existing API.

Do not change the backend unnecessarily.

If required capabilities are missing, list them clearly.

---

# 65. External IDs

Records linked to backend automation should preserve backend identifiers.

Examples:

```text
applications.external_id
assessments.external_id
findings.external_id
retest_runs.external_test_run_id
```

Use unique constraints where appropriate.

This helps prevent duplicate records during re-fetch/reload.

---

# 66. Idempotent Synchronisation

Automation result persistence should be idempotent.

If the same backend result is retrieved twice:

```text
Result X
Result X
```

it should not create:

```text
Finding X
Finding X duplicate
```

Use stable backend IDs and database uniqueness constraints.

---

# 67. Auditability

Important security workflow actions must preserve history.

Do not silently overwrite significant data.

Track:

```text
Finding created
Finding status changed
Ticket created
Ticket status changed
Fix submitted
Comment added
Evidence uploaded
Retest requested
Retest executed
Risk acceptance requested
Risk accepted/rejected
```

---

# 68. Frontend Security

Frontend capability checks are only for user experience.

Actual security must be enforced by:

```text
Supabase RLS
Supabase authentication
Existing API authorization where available
```

Do not rely on hidden buttons as an authorization mechanism.

---

# 69. No Mock Data

Do not create:

```text
VITE_USE_MOCK_API
```

Do not add fictional:

```text
Applications
Assessments
Users
Findings
Tickets
Messages
```

I will populate actual data by running automated tests and using the dashboard.

---

# 70. Plug-and-Play Setup

The frontend should work approximately like:

```bash
git clone <frontend-repository>

cd mobile-security-dashboard

cp .env.example .env
```

Configure:

```env
VITE_API_BASE_URL=http://localhost:8000

VITE_SUPABASE_URL=<project-url>
VITE_SUPABASE_ANON_KEY=<anon-key>
```

Then:

```bash
npm install
npm run dev
```

The automation backend does not need to be merged into this repository.

---

# 71. Supabase Setup

Document how to create a free hosted Supabase project.

Include steps for:

```text
Creating the project
Applying migrations
Configuring authentication
Creating storage buckets
Applying RLS policies
Creating the first users
Assigning roles
Adding the URL/key to .env
```

Also document optional local Supabase development using the Supabase CLI.

Use hosted Supabase as the primary expected setup because multiple users need shared persistent data.

---

# 72. README

Create a concise but complete README covering:

```text
Overview
Architecture
Technology Stack
Roles
Authentication
Supabase Setup
Database Schema
Row Level Security
Storage
Automation API Integration
Environment Variables
Installation
Development
Production Build
Docker
Project Structure
User Setup
Role Assignment
Ticket Workflow
Retest Workflow
Risk Acceptance Workflow
Troubleshooting
```

---

# 73. Docker

Provide an optional frontend Dockerfile.

Conceptually:

```bash
docker build -t mobile-security-dashboard .
docker run -p 3000:80 mobile-security-dashboard
```

Do not package the existing automation backend in the same container.

Supabase should remain an external/local Supabase service.

---

# 74. User Workflows

## Developer Team

```text
Login
  ↓
View Findings
  ↓
Open Finding
  ↓
Work on Risk / Accept Risk
  ↓
Open Ticket
  ↓
Discuss / Add Evidence
  ↓
Submit Fix
  ↓
Request Retest
  ↓
Security Team processes request
```

## Security Team

```text
Login
  ↓
View Backend-Created Assessment
  ↓
Run Automated Test
  ↓
Review Result
  ↓
Finding stored/updated
  ↓
Review Developer Ticket
  ↓
Run Retest
  ↓
Update Finding
  ↓
Progress/Close Ticket
```

## CIO

```text
Login
  ↓
View Dashboard
  ↓
Review Security Posture
  ↓
Review Assessments
  ↓
Review High-Risk Findings
  ↓
Review Outstanding Remediation
  ↓
Review Risk Acceptance
```

---

# 75. Important Workflow Rule

Risk acceptance and technical risk reduction are not the same thing.

Do not automatically do:

```text
Risk accepted
      ↓
Finding = Reduced Risk
```

A finding may remain:

```text
At Risk
```

while the organisation has an accepted-risk record.

Keep both visible separately.

---

# 76. Minimum Screens

Implement at least:

```text
1. Login
2. Dashboard
3. Assessments
4. Assessment Details
5. Security Test Workspace
6. Test Run / Result
7. Findings
8. Finding Details
9. Tickets
10. Ticket Details
11. Settings / User Profile where useful
```

All pages should respect current user capabilities.

---

# 77. Final Validation

Before considering the project complete:

1. Install dependencies.
2. Ensure the development server starts.
3. Run TypeScript checking.
4. Fix TypeScript errors.
5. Run linting if configured.
6. Run the production build.
7. Fix build errors.
8. Verify login/logout.
9. Verify Developer Team role.
10. Verify Security Team role.
11. Verify CIO role.
12. Verify users cannot change their own role.
13. Verify Supabase RLS.
14. Verify Assessment page is read-only with respect to assessment creation.
15. Verify no New Assessment action exists.
16. Verify findings use exactly At Risk, Reduced Risk, and Inconclusive.
17. Verify Developer Team can only work through findings/tickets.
18. Verify Developer Team cannot run tests.
19. Verify Developer Team cannot directly update findings.
20. Verify Developer Team can create remediation tickets.
21. Verify Developer Team can create risk-acceptance tickets.
22. Verify Developer Team can submit fix information.
23. Verify Developer Team can request retests.
24. Verify Security Team can run automated tests.
25. Verify Security Team can see retest requests.
26. Verify Security Team can review risk acceptance.
27. Verify CIO gets primarily read-only executive views.
28. Verify tickets persist.
29. Verify messages persist.
30. Verify multiple authorised users can access the same ticket.
31. Verify findings persist.
32. Verify finding history persists.
33. Verify retest records persist.
34. Verify risk acceptance records persist.
35. Verify automation API remains separate.
36. Verify API results synchronise without duplicates.
37. Verify no mock data exists.
38. Verify empty states work.
39. Verify no sensitive authoritative data depends on browser localStorage.
40. Verify Supabase service-role key is not exposed.
41. Verify iOS results render correctly.
42. Verify Android results render correctly.
43. Verify responsive behaviour.
44. Verify README setup instructions work.
45. Verify the production build succeeds.

Do not stop after creating example components.

Build the complete working frontend and Supabase setup.

---

# 78. Final Deliverables

When complete, provide:

1. Complete dashboard project.
2. Supabase migration/schema files.
3. RLS policies.
4. Storage bucket/policy setup.
5. Authentication implementation.
6. Role/capability implementation.
7. Automation API integration.
8. Finding synchronisation implementation.
9. Ticket workflow.
10. Ticket messaging.
11. Retest workflow.
12. Risk acceptance workflow.
13. Activity/audit history.
14. Environment variable documentation.
15. Hosted Supabase setup instructions.
16. Optional local Supabase instructions.
17. Final directory structure.
18. Commands required to run everything.
19. Explanation of which system owns each category of data.
20. Any automation API capabilities required by the dashboard that are currently missing.

The final product should feel like a real **mobile application security assessment workflow platform** for both iOS and Android.

Prioritise:

```text
Clean UI
Real data only
Role-aware access
Supabase persistence
Strong separation of responsibilities
Reusable components
Low duplication
Compact maintainable project structure
Secure role handling
Auditability
Easy deployment
```