# 1688 Autoprocurement Remote Install

Vercel-hosted installer landing page and shell script endpoint for the customer delivery repository:

```text
yueyue27418/1688-autoprocurement
```

## Local Development

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Smoke Tests

```bash
pnpm lint
pnpm test
pnpm build
curl -LsSf http://localhost:3000/install.sh | bash -s -- --help
curl -LsSf http://localhost:3000/install.sh | bash -s -- --dry-run --tag v1.15.1 --prod
```

## Deployment

Deploy the project root to Vercel. The public production URL becomes the stable customer command source:

```bash
curl -LsSf https://<vercel-domain>/install.sh | bash
```

Set these Vercel environment variables when a stable domain is assigned:

```text
NEXT_PUBLIC_SITE_URL=https://<vercel-domain>
DELIVERY_DEFAULT_TAG=v1.17.4.fix.alpha
```

`GITHUB_TOKEN` is optional. Provide it only if the delivery repository metadata must be read through the GitHub REST API.

Do not store customer `.env` values in this project, in Vercel environment variables, or in the public shell script.
