# Git Reference — Quick Cheatsheet

## Most Used Commands

### Staging
```bash
git add <file>          # stage specific file
git add src/            # stage entire folder
git add -p              # interactive staging (chunk by chunk)
git status              # see what's staged vs unstaged
git diff --staged       # review exactly what will be committed
```

### Committing
```bash
git commit -m "feat(frontend): add login page"
git commit --amend      # fix last commit message (before push)
```

### Branching
```bash
git checkout -b feat/my-feature     # create + switch to new branch
git branch -d feat/my-feature       # delete branch after merge
git branch -a                        # list all branches
```

### Syncing
```bash
git pull --rebase origin main        # pull with rebase (cleaner history)
git push origin feat/my-feature      # push branch to remote
git push --force-with-lease          # safe force push after rebase
```

### Undoing
```bash
git restore <file>                   # discard unstaged changes
git restore --staged <file>          # unstage a file
git revert <commit-hash>             # safely undo a pushed commit
git reset --soft HEAD~1              # undo last commit, keep changes staged
```
