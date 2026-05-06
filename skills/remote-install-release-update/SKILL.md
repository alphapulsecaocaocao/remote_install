---
name: remote-install-release-update
description: Update this repository's 1688 Autoprocurement remote installer website when new delivery repository tags, customer `.env` files, latest-version behavior, install script behavior, or release changelog content must be published. Use for recurring release maintenance on `remote_install`, especially requests mentioning new tags, new env files, `/install.sh`, tag env download routes, latest version cards, or GitHub PR publication.
---

# Remote Install Release Update

Use this workflow to update the remote installer site safely for new delivery versions.

## Operating Rules

- Read `AGENTS.md` first. This repo uses Next.js 16; read the relevant `node_modules/next/dist/docs/` page before editing route handlers or app routes.
- Verify live delivery tags with GitHub before changing latest behavior. Do not trust `releases/latest`; it has historically pointed at old tags.
- Never commit raw `.env` contents or generated files containing secrets. If GitHub push protection blocks a push, remove the secret from Git history instead of bypassing protection.
- Treat `.env` updates as deployment secret updates. Record only byte count/hash in PR notes.
- Use a new branch for each release update and open a GitHub PR.

## Release Update Workflow

1. Sync and branch:

```bash
git fetch origin main
git switch -c codex/update-YYYYMMDD-tags-env origin/main
```

2. Verify new delivery tags:

```bash
gh api 'repos/yueyue27418/1688-autoprocurement/tags?per_page=30' --jq '.[].name'
gh api repos/yueyue27418/1688-autoprocurement/releases/latest --jq '{tag_name,created_at,published_at,html_url}' || true
```

3. Inspect tag metadata for every new tag:

```bash
gh api repos/yueyue27418/1688-autoprocurement/commits/<tag> --jq '{date:.commit.author.date,message:.commit.message}'
```

4. Compare delivery snapshots with tree diffs, not GitHub compare, because delivery tags may not share a normal commit ancestor:

```bash
for tag in <previous-tag> <new-tag-1> <new-tag-2>; do
  gh api "repos/yueyue27418/1688-autoprocurement/git/trees/${tag}?recursive=1" > "/tmp/tree-${tag}.json"
done
```

Use a small Node script to diff path -> sha maps and group changes by area. Summarize user-facing capabilities; do not expose internal path lists in page copy.

5. Update website code:

- `src/lib/releases.ts`: update `FALLBACK_DELIVERY_TAG` to the newest valid tag.
- `src/lib/releases.ts`: add curated `CURATED_CHANGELOGS` entries for new tags.
- `README.md`: update `DELIVERY_DEFAULT_TAG`.
- `src/lib/releases.test.ts` and `src/lib/archive-relay.test.ts`: update latest-tag and delivery-version tests.

6. Handle `.env` files:

- Compute hash and size only:

```bash
wc -c /path/to/.env
shasum -a 256 /path/to/.env
```

- Configure the deployment secret outside Git. Current fallback behavior uses `DELIVERY_ENV_FILE_CONTENT`.
- If different tags need different `.env` files, extend `src/lib/env-relay.ts` to prefer a tag-specific deployment variable before the generic fallback. Use a deterministic key such as:

```text
DELIVERY_ENV_FILE_CONTENT__V1_17_6_ALPHA
```

Derive it from the tag by uppercasing and replacing every non-alphanumeric character with `_`. Add tests for exact tag override and generic fallback. Do not commit actual env values.

7. Validate:

```bash
pnpm test
pnpm lint
pnpm build
bash -n src/install/remote-install.sh
```

For installer shell changes, also run a local `/bin/bash` 3.2 fixture if possible. Empty Bash arrays under `set -u` fail on macOS Bash 3.2, so guard empty array expansion.

8. Secret scan before commit:

```bash
rg -n '/Users/damien/.*\\.env|SUPABASE_ACCESS_TOKEN=|sbp_|DELIVERY_ENV_FILE_PATH' README.md src skills || true
git diff --check
```

Expected allowed mentions are documentation of variable names only, not secret values or local env paths.

9. Commit, push, and open PR:

```bash
git add <changed-files>
git commit -m "update YYYYMMDD delivery tags and env handling"
git push -u origin "$(git branch --show-current)"
```

Use the GitHub connector to create a draft PR. Include:

- newest tags verified
- env file byte count and SHA-256
- note that actual env content must be configured as protected deployment secrets
- validation commands run

## PR Safety Notes

- If push protection triggers, run `git reset --soft HEAD~1`, remove the secret-bearing file/change, recommit, and push again.
- Do not mention full secret values in PR body, final response, logs, or tests.
- Keep release copy semantic and customer-facing: `新增`, `改进`, `修复`, `运维 / 配置`, `迁移与兼容性提示`.
