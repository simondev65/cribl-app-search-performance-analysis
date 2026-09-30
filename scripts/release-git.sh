#!/usr/bin/env bash
# Publish the packaged app so Cribl "Add App > Import from Git" can install it.
#
# Import from Git clones the repo at a ref and needs the package layout
# (static/index.html, default/) at the repo root; it does not build the source.
# This follows the Cribl-Community release convention: materialize static/ and
# default/ from build/<name>-<version>.tgz, commit them on main, tag v<version>,
# and move the `latest` tag to it (the ref the install docs tell users to enter).
#
# Usage: npm run package && npm run release:git
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

name="$(node -p "require('./package.json').name")"
version="$(node -p "require('./package.json').version")"
tgz="$root/build/$name-$version.tgz"
tag="v$version"

[ -f "$tgz" ] || { echo "Missing $tgz. Run: npm run package" >&2; exit 1; }
tar -tzf "$tgz" | grep -qx './static/index.html' || { echo "$tgz has no static/index.html" >&2; exit 1; }

rm -rf static default
tar -xzf "$tgz" -C "$root" ./static ./default
git add -A -f static default package.json
if git diff --staged --quiet; then
  echo "Pack layout unchanged."
else
  git commit -q -m "chore(release): $tag pack layout for Cribl Import from Git" -- static default package.json
fi

git tag -f "$tag"
git tag -f latest "$tag"
git push -q origin HEAD
git push -qf origin "refs/tags/$tag" refs/tags/latest

echo "Published $tag (also tagged latest)"
echo "Cribl: Add App > Import from Git > URL: $(git remote get-url origin)  tag: latest"
