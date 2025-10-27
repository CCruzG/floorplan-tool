#!/usr/bin/env bash
# One-shot helper to commit current changes and push to 'dev' branch.
# Usage: ./scripts/git-push-dev.sh [commit-message]
# If a remote 'origin' isn't configured, you'll be prompted to enter one.

set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
REPO_ROOT="$PWD"
BRANCH="dev"

# Helpers
info() { printf "[info] %s\n" "$*"; }
err() { printf "[error] %s\n" "$*" >&2; }

# Check for git
if ! command -v git >/dev/null 2>&1; then
  err "git is not installed. Install git and try again."
  exit 2
fi

# Initialize repo if needed
if [ ! -d ".git" ]; then
  printf "No .git directory found in %s\n" "$REPO_ROOT"
  printf "Initialize a new git repository here? [y/N]: "
  read -r init
  if [ "${init:-n}" = "y" ] || [ "${init:-n}" = "Y" ]; then
    git init
    info "Initialized empty git repository"
  else
    err "Aborting: repository not initialized."
    exit 3
  fi
fi

# Ensure user identity is configured
if ! git config user.name >/dev/null || [ -z "$(git config user.name --get)" ]; then
  printf "git user.name not set. Enter name to configure (or leave empty to skip): "
  read -r gname
  if [ -n "$gname" ]; then
    git config user.name "$gname"
    info "git user.name set to $gname"
  fi
fi
if ! git config user.email >/dev/null || [ -z "$(git config user.email --get)" ]; then
  printf "git user.email not set. Enter email to configure (or leave empty to skip): "
  read -r gemail
  if [ -n "$gemail" ]; then
    git config user.email "$gemail"
    info "git user.email set to $gemail"
  fi
fi

# Determine commit message
DEFAULT_MSG="chore: prepare release - docs/tests/license"
if [ $# -ge 1 ]; then
  COMMIT_MSG="$*"
else
  printf "Commit message [%s]: " "$DEFAULT_MSG"
  read -r m
  COMMIT_MSG="${m:-$DEFAULT_MSG}"
fi

# Stage changes
git add -A

# Commit if there are staged changes
if git diff --cached --quiet; then
  info "No staged changes to commit."
else
  git commit -m "$COMMIT_MSG"
  info "Committed: $COMMIT_MSG"
fi

# Ensure branch exists and is checked out
current_branch=$(git rev-parse --abbrev-ref HEAD || echo "")
if [ "$current_branch" != "$BRANCH" ]; then
  # Prefer switching to an existing local branch. If it doesn't exist,
  # attempt to create it tracking origin/$BRANCH when possible, otherwise
  # create a new branch from current HEAD.
  if git show-ref --verify --quiet refs/heads/$BRANCH; then
    git checkout "$BRANCH"
    info "Switched to existing local branch '$BRANCH'"
  else
    # try to create tracking branch if origin has it
    if git ls-remote --exit-code --heads origin $BRANCH >/dev/null 2>&1; then
      git fetch origin $BRANCH
      git checkout -b "$BRANCH" --track "origin/$BRANCH"
      info "Created local branch '$BRANCH' tracking origin/$BRANCH"
    else
      git checkout -b "$BRANCH"
      info "Created new local branch '$BRANCH' from current HEAD"
    fi
  fi
fi

# Ensure remote exists
remote_url=$(git remote get-url origin 2>/dev/null || echo "")
if [ -z "$remote_url" ]; then
  printf "No 'origin' remote configured. Enter remote URL to add (SSH or HTTPS), or leave empty to abort: "
  read -r url
  if [ -z "$url" ]; then
    err "Aborting: no remote configured. Add a remote with 'git remote add origin <url>' and try again."
    exit 4
  fi
  git remote add origin "$url"
  info "Added remote origin -> $url"
else
  info "Found origin -> $remote_url"
fi

# Push to remote
info "Pushing branch '$BRANCH' to origin..."
if git push -u origin "$BRANCH"; then
  info "Push complete."
else
  err "Push failed. Resolve any conflicts or authentication issues and retry."
  exit 5
fi

info "Done."
