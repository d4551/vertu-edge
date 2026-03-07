import { expect, test, describe } from "bun:test";
import {
  initDb,
  saveUcpDiscovery,
  getLatestUcpDiscovery,
  listUcpDiscoveries,
  deleteUcpDiscovery,
} from "../src/db";

initDb();

const MOCK_MANIFEST = JSON.stringify({
  ucp: {
    version: "2026-01-11",
    capabilities: [{ name: "dev.ucp.shopping.checkout", version: "2026-01-11" }],
    services: {},
  },
});

// ---------------------------------------------------------------------------
// UCP Discovery persistence CRUD
// ---------------------------------------------------------------------------

describe("UCP discovery persistence", () => {
  test("saveUcpDiscovery returns a non-empty id", () => {
    const id = saveUcpDiscovery({
      serverUrl: "https://shop.example.com",
      manifestJson: MOCK_MANIFEST,
      ucpVersion: "2026-01-11",
      capabilityCount: 1,
      serviceCount: 0,
    });
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  test("saveUcpDiscovery + getLatestUcpDiscovery round-trip", () => {
    const id = saveUcpDiscovery({
      serverUrl: "https://roundtrip.example.com",
      manifestJson: MOCK_MANIFEST,
      ucpVersion: "2026-01-11",
      capabilityCount: 3,
      serviceCount: 2,
    });

    // Verify via list — find the row we just inserted by id
    const result = listUcpDiscoveries(100, 0);
    const row = result.discoveries.find((d) => d.id === id);
    expect(row).toBeDefined();
    expect(row!.serverUrl).toBe("https://roundtrip.example.com");
    expect(row!.ucpVersion).toBe("2026-01-11");
    expect(row!.capabilityCount).toBe(3);
    expect(row!.serviceCount).toBe(2);
    expect(row!.manifestJson).toBe(MOCK_MANIFEST);
    expect(row!.discoveredAt).toBeTruthy();

    // getLatestUcpDiscovery should return a valid row (may or may not be this one due to same-second timestamps)
    const latest = getLatestUcpDiscovery();
    expect(latest).not.toBeNull();
    expect(latest!.ucpVersion).toBe("2026-01-11");
  });

  test("listUcpDiscoveries returns discoveries and total count", () => {
    const result = listUcpDiscoveries(50, 0);
    expect(result.total).toBeGreaterThanOrEqual(2); // at least the 2 we inserted above
    expect(result.discoveries.length).toBeGreaterThanOrEqual(2);
    // Newest first
    if (result.discoveries.length >= 2) {
      expect(result.discoveries[0]!.discoveredAt >= result.discoveries[1]!.discoveredAt).toBe(true);
    }
  });

  test("listUcpDiscoveries respects limit parameter", () => {
    const result = listUcpDiscoveries(1, 0);
    expect(result.discoveries.length).toBe(1);
    expect(result.total).toBeGreaterThanOrEqual(2);
  });

  test("deleteUcpDiscovery removes an existing entry", () => {
    const id = saveUcpDiscovery({
      serverUrl: "https://delete-me.example.com",
      manifestJson: MOCK_MANIFEST,
      ucpVersion: "2026-01-11",
      capabilityCount: 0,
      serviceCount: 0,
    });

    const deleted = deleteUcpDiscovery(id);
    expect(deleted).toBe(true);

    // Verify it's gone — list should not contain this id
    const result = listUcpDiscoveries(100, 0);
    const found = result.discoveries.find((d) => d.id === id);
    expect(found).toBeUndefined();
  });

  test("deleteUcpDiscovery returns false for non-existent id", () => {
    const deleted = deleteUcpDiscovery("non-existent-id-00000");
    expect(deleted).toBe(false);
  });
});
