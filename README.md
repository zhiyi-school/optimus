# Mobile Application Security Assessment Dashboard

A role-aware dashboard for triaging mobile application security findings and
running the remediation → retest → risk-acceptance workflow between Developer
Teams, the Security Team, and the CIO.

This is a standalone frontend. It drives the automation backend
(`mobile_playbook_automation`) for test execution, and uses
[Supabase](https://supabase.com) for its own persistent data — users, roles,
findings, tickets, and audit history. The two systems stay separate; this repo
never modifies the automation backend.

**The dashboard is not the authoritative synchroniser.** Automation results
reach Supabase through a worker that runs on the automation host. The browser
starts runs, watches progress, and reads what the worker has already published;
it never writes a report feed to Supabase itself. See
[docs/automation-api.md](./docs/automation-api.md).

## Quick start

```bash
cp .env.example .env   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

You will also need a Supabase project with the migrations applied, and the
automation backend running separately. Full walkthrough:
[docs/setup.md](./docs/setup.md).

```bash
npm run dev         # dev server on :5173
npm run build       # typecheck (tsc -b) + production build
npm run preview     # serve the production build locally
npm test            # vitest
npm run typecheck   # tsc -b
npm run lint        # eslint
```

## Stack

React, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router, Supabase JS
client. See [docs/architecture.md](./docs/architecture.md).

## Documentation

| Doc | Covers |
|---|---|
| [docs/setup.md](./docs/setup.md) | Local setup, Supabase project, migrations, role assignment, connecting the backend |
| [docs/architecture.md](./docs/architecture.md) | Architecture, data ownership, project structure, routes |
| [docs/configuration.md](./docs/configuration.md) | Ports, timeouts, polling intervals, and other non-env-var settings |
| [docs/automation-api.md](./docs/automation-api.md) | How the dashboard integrates with the automation backend |
| [docs/data-model.md](./docs/data-model.md) | Tables, relationships, RLS design, storage conventions |
| [docs/roles-and-workflows.md](./docs/roles-and-workflows.md) | Role capabilities, authentication, ticket and risk-acceptance workflows |
| [docs/frontend-integration.md](./docs/frontend-integration.md) | Reusing this dashboard, and the backend compatibility contract |
| [docs/testing.md](./docs/testing.md) | Test suite, typecheck, lint, build |
| [docs/deployment.md](./docs/deployment.md) | Environment variables, production build, Docker, reverse proxy |

Documentation examples use placeholder identifiers (`Example App`,
`example-app`, `com.example.placeholder`, `<RUN_ID>`,
`https://dashboard.example.com`). Real applications under test appear only in
backend configuration and generated reports, neither of which lives here.

## License

Internal project — no license specified.
