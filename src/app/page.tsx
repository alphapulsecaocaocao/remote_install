import { headers } from "next/headers";

import {
  DEFAULT_INSTALL_ROOT,
  DELIVERY_REPO,
  DELIVERY_REPO_URL,
} from "@/lib/delivery-repo";
import { getDeliveryVersions, getLatestDeliveryVersion } from "@/lib/releases";

type Command = {
  label: string;
  command: string;
};

export default async function Home() {
  const siteUrl = await getRequestOrigin();
  const commands = buildCommands(siteUrl);
  const [latest, versions] = await Promise.all([
    getLatestDeliveryVersion().catch(() => null),
    getDeliveryVersions().catch(() => []),
  ]);

  return (
    <main className="min-h-screen bg-[#f7f6f1] text-[#1d2520]">
      <section className="border-b border-[#d8d3c5] bg-[#fbfaf6]">
        <div className="mx-auto grid min-h-[82vh] w-full max-w-7xl gap-10 px-6 py-10 lg:grid-cols-[1fr_440px] lg:items-center lg:px-10">
          <div className="max-w-3xl">
            <p className="mb-5 inline-flex rounded-full border border-[#c9b68f] bg-[#fff8e8] px-3 py-1 font-mono text-sm text-[#6f5522]">
              delivery repo: {DELIVERY_REPO}
            </p>
            <h1 className="max-w-3xl text-5xl font-semibold leading-[1.08] text-[#17231d] md:text-7xl">
              1688 Autoprocurement remote installer
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#556258]">
              A stable Vercel endpoint for installing the customer delivery
              build. The script downloads only from the delivery repository by
              default, keeps local secrets out of public code, and forwards
              install options to the packaged deployment scripts.
            </p>
            <div className="mt-8 overflow-hidden border border-[#242d27] bg-[#111713] shadow-[8px_8px_0_#c7dccf]">
              <div className="flex items-center justify-between border-b border-[#2f3b34] bg-[#18221d] px-4 py-3">
                <span className="font-mono text-sm text-[#b7d5c1]">
                  install.sh
                </span>
                <span className="rounded-full bg-[#35a673] px-2 py-1 text-xs font-medium text-white">
                  public
                </span>
              </div>
              <pre className="overflow-x-auto p-5 font-mono text-sm leading-7 text-[#eaf5ed]">
                <code>{commands[1].command}</code>
              </pre>
            </div>
          </div>

          <aside className="border border-[#cfc7b5] bg-white p-5 shadow-[6px_6px_0_#e3d8bc]">
            <div className="grid grid-cols-2 gap-3">
              <Metric label="latest" value={latest?.tagName ?? "pending"} />
              <Metric label="source" value={latest?.source ?? "github"} />
              <Metric label="default dir" value={DEFAULT_INSTALL_ROOT} wide />
              <Metric label="installer" value="/install.sh" wide />
            </div>
            <div className="mt-6 border-t border-[#e7e0d2] pt-5">
              <p className="text-sm font-medium uppercase text-[#667065]">
                Flow
              </p>
              <ol className="mt-4 space-y-3 text-sm text-[#47534b]">
                <li className="flex gap-3">
                  <Step value="1" />
                  Fetch installer from Vercel.
                </li>
                <li className="flex gap-3">
                  <Step value="2" />
                  Resolve release or tag from the delivery repository.
                </li>
                <li className="flex gap-3">
                  <Step value="3" />
                  Install into a release directory and preserve shared env.
                </li>
              </ol>
            </div>
          </aside>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-12 lg:px-10">
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <div>
            <h2 className="text-2xl font-semibold text-[#17231d]">
              Install commands
            </h2>
            <div className="mt-5 space-y-4">
              {commands.map((item) => (
                <CommandBlock key={item.label} {...item} />
              ))}
            </div>
            <div className="mt-8">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold text-[#17231d]">
                    Pinned versions
                  </h3>
                  <p className="mt-1 text-sm text-[#647068]">
                    Available delivery tags from v1.15.1 onward.
                  </p>
                </div>
                <a
                  className="font-medium text-[#096b4d] underline underline-offset-4"
                  href={`${siteUrl}/api/downloads/latest`}
                >
                  Download latest
                </a>
              </div>
              <div className="mt-4 space-y-3">
                {versions.length > 0 ? (
                  versions.map((version) => (
                    <PinnedVersion
                      key={version.tagName}
                      siteUrl={siteUrl}
                      tagName={version.tagName}
                    />
                  ))
                ) : (
                  <div className="border border-[#d6cebd] bg-white px-4 py-4 text-sm text-[#556258]">
                    No pinned versions are available right now.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <InfoBlock title="Secrets">
              Real `.env` values are never stored in this Vercel project or in
              the public shell script. Use an existing deployment env, a local
              `--env-file`, or a short-lived private `--env-url`.
            </InfoBlock>
            <InfoBlock title="Verification">
              Use `--sha256` with private bundles or release checksum artifacts
              when strict archive verification is required.
            </InfoBlock>
            <InfoBlock title="Links">
              <a
                className="font-medium text-[#096b4d] underline underline-offset-4"
                href={DELIVERY_REPO_URL}
              >
                Open delivery repository
              </a>
              {latest ? (
                <a
                  className="mt-2 block font-medium text-[#096b4d] underline underline-offset-4"
                  href={latest.htmlUrl}
                >
                  Open latest delivery version
                </a>
              ) : null}
              <a
                className="mt-2 block font-medium text-[#096b4d] underline underline-offset-4"
                href={`${siteUrl}/api/downloads/latest`}
              >
                Download latest archive
              </a>
            </InfoBlock>
          </div>
        </div>
      </section>
    </main>
  );
}

async function getRequestOrigin() {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  if (!host) {
    return "https://1688autoprocurement.xleeelx.online";
  }

  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  return `${protocol}://${host}`;
}

function buildCommands(siteUrl: string): Command[] {
  return [
    {
      label: "Default",
      command: `curl -LsSf ${siteUrl}/install.sh | bash`,
    },
    {
      label: "Production",
      command: `curl -LsSf ${siteUrl}/install.sh | bash -s -- --prod`,
    },
    {
      label: "Custom directory",
      command: `curl -LsSf ${siteUrl}/install.sh | bash -s -- --dir ${DEFAULT_INSTALL_ROOT} --tag v1.15.1 --prod`,
    },
  ];
}

function PinnedVersion({
  siteUrl,
  tagName,
}: {
  siteUrl: string;
  tagName: string;
}) {
  const installCommand = `curl -LsSf ${siteUrl}/install.sh | bash -s -- --tag ${tagName} --prod`;
  const downloadUrl = `${siteUrl}/api/downloads/tags/${tagName}`;

  return (
    <div className="border border-[#d6cebd] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eee8dc] px-4 py-3">
        <p className="font-mono text-sm font-medium text-[#17231d]">
          {tagName}
        </p>
        <a
          className="font-medium text-[#096b4d] underline underline-offset-4"
          href={downloadUrl}
        >
          Download archive
        </a>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-sm leading-7 text-[#17231d]">
        <code>{installCommand}</code>
      </pre>
    </div>
  );
}

function Metric({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <p className="text-xs font-medium uppercase text-[#667065]">{label}</p>
      <p className="mt-1 break-words font-mono text-sm text-[#17231d]">
        {value}
      </p>
    </div>
  );
}

function Step({ value }: { value: string }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1f7a5f] font-mono text-xs text-white">
      {value}
    </span>
  );
}

function CommandBlock({ label, command }: Command) {
  return (
    <div className="border border-[#d6cebd] bg-white">
      <div className="border-b border-[#eee8dc] px-4 py-3">
        <p className="text-sm font-medium text-[#39443d]">{label}</p>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-sm leading-7 text-[#17231d]">
        <code>{command}</code>
      </pre>
    </div>
  );
}

function InfoBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-[#d6cebd] bg-[#fffdf8] p-5">
      <h2 className="font-semibold text-[#17231d]">{title}</h2>
      <div className="mt-3 text-sm leading-6 text-[#556258]">{children}</div>
    </section>
  );
}
