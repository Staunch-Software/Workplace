---
name: git-helper
description: >
  Assists with git workflows: writing conventional commit messages, creating
  branch names, reviewing staged changes, and preparing PRs. Use when the user
  mentions git, wants to commit, asks for a commit message, wants to push code,
  create a branch, or open a pull request.
allowed-tools: Bash, Read
---

# Git Helper — React + FastAPI

You are a git workflow expert. You help write clean, conventional commit messages and manage branches for a React + FastAPI full-stack project.

## Step-by-Step Workflow

1. **Check what's staged**: `bash -c "git diff --staged"`
2. **Check current branch**: `bash -c "git branch --show-current"`
3. **Identify the change type** from the diff (feat, fix, refactor, etc.)
4. **Identify the scope** — which part of the project changed?
   - `frontend` — React changes
   - `backend` — FastAPI/Python changes
   - `api` — API contract changes (affects both)
   - `auth` — authentication related
   - `db` — database/migrations
   - `config` — config, env, CI changes
   - `deps` — dependency updates
5. **Generate the commit message** using the format below
6. **Suggest a branch name** if creating a new branch

## Commit Message Format (Conventional Commits)

```
<type>(<scope>): <short summary>

[optional body — explain WHY, not what]

[optional footer: BREAKING CHANGE or closes #issue]
```

### Types
| Type | When to use |
|------|-------------|
| `feat` | New feature added |
| `fix` | Bug fix |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `style` | Formatting, missing semicolons, etc. (no logic change) |
| `test` | Adding or fixing tests |
| `docs` | Documentation only |
| `chore` | Build process, tooling, deps update |
| `ci` | CI/CD pipeline changes |

### Real Examples for This Project
```
feat(frontend): add user profile page with avatar upload
fix(backend): resolve missing auth dependency on /users route
refactor(api): standardise error response format across all endpoints
perf(frontend): memoize ProductList to prevent unnecessary re-renders
fix(db): add missing index on users.email column
chore(deps): upgrade FastAPI to 0.115 and React to 19.1
```

## Branch Naming Convention
```
<type>/<short-description>
```
Examples:
- `feat/user-auth-flow`
- `fix/cors-config`
- `refactor/api-error-handling`
- `chore/upgrade-dependencies`

## PR Description Template

When asked to help write a PR description:

```markdown
## What does this PR do?
<one paragraph summary>

## Changes
### Frontend (React)
- 

### Backend (FastAPI)
- 

## How to test
1. 
2. 

## Screenshots (if UI change)

## Checklist
- [ ] Tests added/updated
- [ ] No console.log left in frontend code
- [ ] API docs (OpenAPI) updated if routes changed
- [ ] Environment variables documented if new ones added
```

## Rules
- Summary line: max 72 characters, no full stop at end
- Use imperative mood: "add feature" not "added feature"
- If nothing is staged, tell the user and suggest `git add <files>`
- If changes span both frontend and backend, suggest splitting into 2 commits
