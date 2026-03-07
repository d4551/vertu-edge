import { afterEach, describe, expect, test } from "bun:test";
import { createControlPlaneApp } from "../src/app";
import { API_HEALTH_ROUTE, CONTROL_PLANE_SCRIPT_PATH } from "../src/runtime-constants";

const AUTH_TOKEN_ENV = "VERTU_AUTH_TOKEN";
const AUTH_COOKIE_NAME_ENV = "VERTU_AUTH_COOKIE_NAME";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

const initialAuthToken = process.env[AUTH_TOKEN_ENV];
const initialAuthCookieName = process.env[AUTH_COOKIE_NAME_ENV];

afterEach(() => {
  restoreEnv(AUTH_TOKEN_ENV, initialAuthToken);
  restoreEnv(AUTH_COOKIE_NAME_ENV, initialAuthCookieName);
});

describe("control-plane auth boundary", () => {
  test("health remains public when auth is enabled", async () => {
    process.env[AUTH_TOKEN_ENV] = "secret-token";
    const app = createControlPlaneApp();

    const response = await app.handle(new Request(`http://localhost${API_HEALTH_ROUTE}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      route: API_HEALTH_ROUTE,
      status: "ok",
    });
  });

  test("dashboard page returns unauthorized HTML document without auth token", async () => {
    process.env[AUTH_TOKEN_ENV] = "secret-token";
    const app = createControlPlaneApp();

    const response = await app.handle(new Request("http://localhost/"));
    const html = await response.text();

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('data-state="unauthorized"');
    expect(html).toContain("Authorization Required");
  });

  test("HTMX dashboard fragment returns unauthorized fragment without auth token", async () => {
    process.env[AUTH_TOKEN_ENV] = "secret-token";
    const app = createControlPlaneApp();

    const response = await app.handle(new Request("http://localhost/dashboard/overview", {
      headers: {
        "hx-request": "true",
        accept: "text/html",
      },
    }));
    const html = await response.text();

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).not.toContain("<!DOCTYPE html>");
    expect(html).toContain('data-state="unauthorized"');
  });

  test("protected API routes return unauthorized JSON envelopes without auth token", async () => {
    process.env[AUTH_TOKEN_ENV] = "secret-token";
    const app = createControlPlaneApp();

    const response = await app.handle(new Request("http://localhost/api/models/sources", {
      headers: {
        accept: "application/json",
      },
    }));
    const payload = await readJson(response);

    expect(response.status).toBe(401);
    expect(payload.route).toBe("/api/models/sources");
    expect(payload.state).toBe("unauthorized");
    expect(payload.data).toEqual({ authenticated: false });
    expect((payload.error as Record<string, unknown>).message).toBe("This control-plane route requires a valid Vertu auth token.");
  });

  test("cookie auth grants access to protected routes", async () => {
    process.env[AUTH_TOKEN_ENV] = "secret-token";
    const app = createControlPlaneApp();

    const response = await app.handle(new Request("http://localhost/dashboard/overview", {
      headers: {
        cookie: "vertu_edge_auth=secret-token",
      },
    }));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Operator Command Center");
    expect(html).not.toContain('data-state="unauthorized"');
  });

  test("auth env and cookie name are read at request time instead of app creation time", async () => {
    delete process.env[AUTH_TOKEN_ENV];
    delete process.env[AUTH_COOKIE_NAME_ENV];
    const app = createControlPlaneApp();

    process.env[AUTH_TOKEN_ENV] = "late-token";
    process.env[AUTH_COOKIE_NAME_ENV] = "late_cookie";

    const response = await app.handle(new Request("http://localhost/dashboard/overview", {
      headers: {
        cookie: "late_cookie=late-token",
      },
    }));

    expect(response.status).toBe(200);
  });

  test("public assets remain reachable when auth is enabled", async () => {
    process.env[AUTH_TOKEN_ENV] = "secret-token";
    const app = createControlPlaneApp();

    const response = await app.handle(new Request(`http://localhost${CONTROL_PLANE_SCRIPT_PATH}`));
    expect(response.status).toBe(200);
  });
});
