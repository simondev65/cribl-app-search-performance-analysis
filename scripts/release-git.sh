#!/usr/bin/env bash
# Publish the packaged app so Cribl "Add App > Import from Git" can install it.
#
# Import from Git needs the *package layout* (package.json, static/index.html,
# default/) at the repo root of a tag, not the source tree. This extracts
# build/<name>-<version>.tgz onto the `release` branch, tags it v<version>,
# and pushes both. Source stays on main.
#
# Usage: npm run package && bash scripts/release-git.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

name="$(node -p "require('./package.json').name")"
version="$(node -p "require('./package.json').version")"
tgz="$root/build/$name-$version.tgz"
tag="v$version"
branch="release"

[ -f "$tgz" ] || { echo "Missing $tgz. Run: npm run package" >&2; exit 1; }
tar -tzf "$tgz" | grep -qx './static/index.html' || { echo "$tgz has no static/index.html" >&2; exit 1; }

work="$(mktemp -d)"
trap 'git worktree remove --force "$work" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

git fetch -q origin "$branch" 2>/dev/null || true
if git rev-parse -q --verify "origin/$branch" >/dev/null; then
  git worktree add -q -B "$branch" "$work" "origin/$branch"
else
  git worktree add -q --detach "$work"
  git -C "$work" checkout -q --orphan "$branch"
fi

git -C "$work" rm -rqf --ignore-unmatch .
tar -xzf "$tgz" -C "$work"
git -C "$work" add -A
git -C "$work" commit -q --allow-empty -m "Release $tag (package layout for Import from Git)"

git -C "$work" tag -f "$tag"
git -C "$work" push -q origin "$branch"
git -C "$work" push -qf origin "refs/tags/$tag"

url="$(git remote get-url origin)"
echo "Published $tag on branch $branch"
echo "Cribl: Add App > Import from Git > URL: $url  ref: $tag (or branch: $branch)"
