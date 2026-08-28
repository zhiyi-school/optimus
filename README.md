# Mobile Application Security Assessment Dashboard

A role-aware dashboard for triaging mobile application security findings
and running the remediation → retest → risk-acceptance workflow between
Developer Teams, the Security Team, and the CIO.

This is a standalone frontend. It drives the existing automation backend
([`mobile_playbook_automation`](../playbook/mobile_playbook_automation))
for test execution, and uses [Supabase](https://supabase.com) for its own
persistent data — users, roles, findings, tickets, and audit history. The
two systems stay separate; this repo never modifies the automation
backend.

## Quick Start

```bash
git clone <this-repository>
cd mobile-security-dashboard
cp .env.example .env   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY

npm install
npm run dev
```

You'll also need a Supabase project with the schema applied, and the
automation backend running separately — see
[docs/SUPABASE_SETUP.md](./docs/SUPABASE_SETUP.md) and
[docs/AUTOMATION_API.md](./docs/AUTOMATION_API.md).

```bash
npm run build      # production build
npm run preview    # preview the production build
npm run lint        # eslint
```

## Stack

React, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router,
Supabase JS client. See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for
the full breakdown.

## Documentation

| Doc | Covers |
|---|---|
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System architecture, tech stack, data ownership, project structure, routes |
| [docs/SUPABASE_SETUP.md](./docs/SUPABASE_SETUP.md) | Creating and configuring a Supabase project, role assignment, local dev |
| [docs/DATABASE.md](./docs/DATABASE.md) | RLS design rationale, storage path conventions |
| [docs/ROLES_AND_WORKFLOWS.md](./docs/ROLES_AND_WORKFLOWS.md) | Role capabilities, authentication, ticket & risk-acceptance workflows |
| [docs/AUTOMATION_API.md](./docs/AUTOMATION_API.md) | How the dashboard integrates with the automation backend, known gaps |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Environment variables, production build, Docker, troubleshooting |
| [docs/CONFIGURATION.md](./docs/CONFIGURATION.md) | Ports, hosts, timeouts, polling intervals, and other non-env-var settings |
| [docs/prompt.md](./docs/prompt.md) | Original project specification |

## License

Internal project — no license specified.
