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
curl -LsSf https://1688autoprocurement.xleeelx.online/install.sh | bash
```

The app relays private GitHub archives through public download endpoints so customers never need GitHub repository access:

```bash
curl -L https://1688autoprocurement.xleeelx.online/api/downloads/latest -o delivery.tar.gz
curl -L https://1688autoprocurement.xleeelx.online/api/downloads/tags/v1.15.1 -o delivery.tar.gz
```

Set these Vercel environment variables:

```text
NEXT_PUBLIC_SITE_URL=https://1688autoprocurement.xleeelx.online
DELIVERY_DEFAULT_TAG=v1.17.4.fix.alpha
GITHUB_TOKEN=<repo read token>
```

`GITHUB_TOKEN` is required when the delivery repository is private. It is used only server-side to resolve metadata and stream private tag archives through `/api/downloads/*`.

Do not store customer `.env` values in this project, in Vercel environment variables, or in the public shell script.
