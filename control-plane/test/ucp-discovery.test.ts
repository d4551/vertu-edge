import { expect, test } from "bun:test";
import { discoverBusinessCapabilities, type UCPManifest } from "../src/ucp-discovery";
import { withMockedFetch } from "./_helpers";

const validServicesManifest: UCPManifest = {
  ucp: {
    version: "2026-01-11",
    services: {
      "dev.ucp.shopping": {
        version: "2026-01-11",
        spec: "https://ucp.dev/specification/overview",
        rest: {
          schema: "https://ucp.dev/services/shopping/rest.openapi.json",
          endpoint: "https://business.example.com/ucp/v1",
        },
      },
    },
    capabilities: [
      {
        name: "dev.ucp.shopping.checkout",
        version: "2026-01-11",
        spec: "https://ucp.dev/specification/checkout",
        schema: "https://ucp.dev/schemas/shopping/checkout.json",
      },
    ],
  },
  payment: {
    handlers: [
      {
        id: "com.google.pay",
        name: "gpay",
        version: "2024-12-03",
        spec: "https://developers.google.com/merchant/ucp/guides/gpay-payment-handler",
        config_schema: "https://pay.google.com/gp/p/ucp/2026-01-11/schemas/gpay_config.json",
        instrument_schemas: [
          "https://pay.google.com/gp/p/ucp/2026-01-11/schemas/gpay_card_payment_instrument.json",
        ],
      },
    ],
  },
};

const validTransportsManifest = {
  ucp: {
    version: "2026-01-11",
    capabilities: [
      {
        name: "dev.ucp.shopping.checkout",
        version: "2026-01-11",
        transports: [
          { name: "rest", endpoint: "https://business.example.com/ucp/checkout" },
        ],
      },
    ],
  },
};

const validManifestWithSigningKeys: UCPManifest = {
  ...validServicesManifest,
  signing_keys: [
    {
      kid: "key-2026-01",
      kty: "EC",
      crv: "P-256",
      x: "base64url_encoded_x_coordinate",
      y: "base64url_encoded_y_coordinate",
      use: "sig",
      alg: "ES256",
    },
  ],
};

function expectDiscoverSuccess(
  result: Awaited<ReturnType<typeof discoverBusinessCapabilities>>,
): UCPManifest {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected UCP discovery success, received ${result.error}`);
  }
  return result.manifest;
}

test("discoverBusinessCapabilities returns success result for valid services-based manifest", async () => {
  const result = await withMockedFetch(
    async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(url).toContain("/.well-known/ucp");
      return new Response(JSON.stringify(validServicesManifest), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      },
    () => discoverBusinessCapabilities("https://shop.example.com"),
  );
  const safeManifest = expectDiscoverSuccess(result);

  expect(safeManifest.ucp.version).toBe("2026-01-11");
  expect(safeManifest.ucp.capabilities).toHaveLength(1);
  expect(safeManifest.ucp.capabilities[0]!.name).toBe("dev.ucp.shopping.checkout");
  expect(Object.keys(safeManifest.ucp.services ?? {}).length).toBe(1);
  expect(safeManifest.payment?.handlers?.length).toBe(1);
});

test("discoverBusinessCapabilities returns success result for transports-only manifest", async () => {
  const result = await withMockedFetch(
    async () =>
      new Response(JSON.stringify(validTransportsManifest), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    () => discoverBusinessCapabilities("https://shop.example.com"),
  );
  const safeManifest = expectDiscoverSuccess(result);

  expect(safeManifest.ucp.version).toBe("2026-01-11");
  expect(safeManifest.ucp.capabilities).toHaveLength(1);
  const transportCap = safeManifest.ucp.capabilities[0]!;
  expect((transportCap.transports ?? []).length).toBe(1);
  expect((transportCap.transports ?? [])[0]?.endpoint).toBe(
    "https://business.example.com/ucp/checkout",
  );
});

test("discoverBusinessCapabilities returns success result with signing_keys", async () => {
  const result = await withMockedFetch(
    async () =>
      new Response(JSON.stringify(validManifestWithSigningKeys), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    () => discoverBusinessCapabilities("https://shop.example.com"),
  );
  const safeManifest = expectDiscoverSuccess(result);

  const signingKeys = safeManifest.signing_keys ?? [];
  expect(signingKeys).toHaveLength(1);
  expect(signingKeys[0]!.kid).toBe("key-2026-01");
  expect(signingKeys[0]!.kty).toBe("EC");
});

test("discoverBusinessCapabilities returns not_found for invalid URL", async () => {
  const result = await discoverBusinessCapabilities("not-a-valid-url");
  expect(result).toEqual({ ok: false, error: "not_found" });
});

test("discoverBusinessCapabilities returns not_found for 404 response", async () => {
  const result = await withMockedFetch(
    async () => new Response("Not Found", { status: 404 }),
    () => discoverBusinessCapabilities("https://shop.example.com"),
  );
  expect(result).toEqual({ ok: false, error: "not_found" });
});

test("discoverBusinessCapabilities returns invalid_manifest for non-JSON content-type", async () => {
  const result = await withMockedFetch(
    async () =>
      new Response(JSON.stringify(validServicesManifest), {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    () => discoverBusinessCapabilities("https://shop.example.com"),
  );
  expect(result).toEqual({ ok: false, error: "invalid_manifest" });
});

test("discoverBusinessCapabilities returns invalid_json for invalid JSON", async () => {
  const result = await withMockedFetch(
    async () =>
      new Response("not valid json {", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    () => discoverBusinessCapabilities("https://shop.example.com"),
  );
  expect(result).toEqual({ ok: false, error: "invalid_json" });
});

test("discoverBusinessCapabilities returns invalid_manifest for invalid manifest structure", async () => {
  const result = await withMockedFetch(
    async () =>
      new Response(JSON.stringify({ ucp: { version: "2026-01-11" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    () => discoverBusinessCapabilities("https://shop.example.com"),
  );
  expect(result).toEqual({ ok: false, error: "invalid_manifest" });
});

test("discoverBusinessCapabilities returns network error on fetch rejection", async () => {
  const result = await withMockedFetch(
    async () => {
      throw new Error("Network error");
    },
    () => discoverBusinessCapabilities("https://shop.example.com"),
  );
  expect(result).toEqual({ ok: false, error: "network" });
});

test("discoverBusinessCapabilities normalizes URL to .well-known/ucp", async () => {
  let capturedUrl = "";
  const result = await withMockedFetch(
    async (input) => {
      capturedUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new Response(JSON.stringify(validServicesManifest), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    () => discoverBusinessCapabilities("https://shop.example.com/path"),
  );
  expect(result.ok).toBe(true);
  expect(capturedUrl).toBe("https://shop.example.com/.well-known/ucp");
});
