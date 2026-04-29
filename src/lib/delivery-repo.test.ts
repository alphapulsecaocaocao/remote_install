import { describe, expect, it } from "vitest";

import {
  DELIVERY_REPO,
  buildTagArchiveUrl,
  isValidDeliveryTag,
  normalizeTagName,
} from "./delivery-repo";

describe("delivery repo helpers", () => {
  it("pins all default install lookups to the delivery repository", () => {
    expect(DELIVERY_REPO).toBe("yueyue27418/1688-autoprocurement");
  });

  it("normalizes GitHub refs into plain tag names", () => {
    expect(normalizeTagName("refs/tags/v1.15.1")).toBe("v1.15.1");
    expect(normalizeTagName(" v1.15.1 ")).toBe("v1.15.1");
  });

  it("accepts conservative delivery tag names and rejects shell-sensitive input", () => {
    expect(isValidDeliveryTag("v1.15.1")).toBe(true);
    expect(isValidDeliveryTag("release-2026.04.30")).toBe(true);
    expect(isValidDeliveryTag("../main")).toBe(false);
    expect(isValidDeliveryTag("v1.0.0;rm -rf /")).toBe(false);
    expect(isValidDeliveryTag("feature branch")).toBe(false);
  });

  it("builds tag archive URLs from the delivery repository only", () => {
    expect(buildTagArchiveUrl("v1.15.1")).toBe(
      "https://1688autoprocurement.xleeelx.online/api/downloads/tags/v1.15.1",
    );
  });
});
