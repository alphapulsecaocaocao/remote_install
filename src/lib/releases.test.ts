import { describe, expect, it, vi } from "vitest";

import { getLatestDeliveryVersion } from "./releases";

describe("getLatestDeliveryVersion", () => {
  it("uses the delivery repository latest release when GitHub releases exist", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tag_name: "v1.15.1",
        html_url:
          "https://github.com/yueyue27418/1688-autoprocurement/releases/tag/v1.15.1",
      }),
    });

    const latest = await getLatestDeliveryVersion(fetchMock as typeof fetch);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/yueyue27418/1688-autoprocurement/releases/latest",
      expect.any(Object),
    );
    expect(latest).toMatchObject({
      source: "release",
      tagName: "v1.15.1",
      archiveUrl:
        "https://1688autoprocurement.xleeelx.online/api/downloads/tags/v1.15.1",
    });
  });

  it("falls back to delivery repository tags when no latest release exists", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { name: "v1.9.0" },
          { name: "v1.15.1" },
          { name: "v1.10.0" },
        ],
      });

    const latest = await getLatestDeliveryVersion(fetchMock as typeof fetch);

    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.github.com/repos/yueyue27418/1688-autoprocurement/tags?per_page=100",
      expect.any(Object),
    );
    expect(latest).toMatchObject({
      source: "tag",
      tagName: "v1.15.1",
    });
  });

  it("uses the configured default tag when GitHub metadata is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: false, status: 404 });

    const latest = await getLatestDeliveryVersion(fetchMock as typeof fetch);

    expect(latest).toMatchObject({
      source: "configured",
      tagName: "v1.17.4.fix.alpha",
      archiveUrl:
        "https://1688autoprocurement.xleeelx.online/api/downloads/tags/v1.17.4.fix.alpha",
    });
  });
});
