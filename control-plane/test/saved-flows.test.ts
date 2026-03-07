import { expect, test, describe } from "bun:test";
import { initDb } from "../src/db";
import {
  createSavedFlow,
  deleteSavedFlow,
  getSavedFlow,
  listSavedFlows,
  updateSavedFlow,
} from "../src/db";
import { FLOW_TEMPLATES } from "../src/config";

initDb();

// ---------------------------------------------------------------------------
// Saved flows CRUD
// ---------------------------------------------------------------------------

describe("Saved flows CRUD", () => {
  test("createSavedFlow returns a valid id and getSavedFlow retrieves it", () => {
    const id = createSavedFlow({ name: "Test Flow", yaml: "appId: com.test\n---\n- launchApp" });
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");

    const flow = getSavedFlow(id);
    expect(flow).not.toBeNull();
    expect(flow!.name).toBe("Test Flow");
    expect(flow!.yaml).toContain("launchApp");
    expect(flow!.createdAt).toBeTruthy();
    expect(flow!.updatedAt).toBeTruthy();
  });

  test("createSavedFlow with description and tags", () => {
    const id = createSavedFlow({
      name: "Tagged Flow",
      yaml: "appId: test\n---\n- scroll",
      description: "A scroll flow",
      tags: '["automation","test"]',
    });

    const flow = getSavedFlow(id);
    expect(flow).not.toBeNull();
    expect(flow!.description).toBe("A scroll flow");
    expect(flow!.tags).toBe('["automation","test"]');
  });

  test("getSavedFlow returns null for missing id", () => {
    expect(getSavedFlow("nonexistent-id")).toBeNull();
  });

  test("listSavedFlows returns paginated results", () => {
    createSavedFlow({ name: "Flow A", yaml: "yaml-a" });
    createSavedFlow({ name: "Flow B", yaml: "yaml-b" });
    createSavedFlow({ name: "Flow C", yaml: "yaml-c" });

    const result = listSavedFlows(2, 0);
    expect(result.total).toBeGreaterThanOrEqual(3);
    expect(result.flows.length).toBeLessThanOrEqual(2);
  });

  test("listSavedFlows orders by most recent first", () => {
    const result = listSavedFlows(50, 0);
    if (result.flows.length >= 2) {
      expect(result.flows[0]!.updatedAt >= result.flows[1]!.updatedAt).toBe(true);
    }
  });

  test("updateSavedFlow changes name and yaml", () => {
    const id = createSavedFlow({ name: "Original", yaml: "original-yaml" });
    updateSavedFlow(id, { name: "Updated", yaml: "updated-yaml" });

    const flow = getSavedFlow(id);
    expect(flow!.name).toBe("Updated");
    expect(flow!.yaml).toBe("updated-yaml");
  });

  test("updateSavedFlow touches updatedAt", () => {
    const id = createSavedFlow({ name: "Timestamps", yaml: "yaml" });
    const before = getSavedFlow(id)!;
    updateSavedFlow(id, { name: "After" });
    const after = getSavedFlow(id)!;
    expect(after.updatedAt >= before.updatedAt).toBe(true);
  });

  test("deleteSavedFlow removes the flow", () => {
    const id = createSavedFlow({ name: "Delete Me", yaml: "yaml" });
    expect(getSavedFlow(id)).not.toBeNull();

    const deleted = deleteSavedFlow(id);
    expect(deleted).toBe(true);
    expect(getSavedFlow(id)).toBeNull();
  });

  test("deleteSavedFlow returns false for missing flow", () => {
    expect(deleteSavedFlow("does-not-exist")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Flow templates
// ---------------------------------------------------------------------------

describe("Flow templates", () => {
  test("FLOW_TEMPLATES is a non-empty array", () => {
    expect(Array.isArray(FLOW_TEMPLATES)).toBe(true);
    expect(FLOW_TEMPLATES.length).toBeGreaterThanOrEqual(3);
  });

  test("each template has name, description, and yaml", () => {
    for (const tpl of FLOW_TEMPLATES) {
      expect(typeof tpl.name).toBe("string");
      expect(tpl.name.length).toBeGreaterThan(0);
      expect(typeof tpl.description).toBe("string");
      expect(tpl.description.length).toBeGreaterThan(0);
      expect(typeof tpl.yaml).toBe("string");
      expect(tpl.yaml.length).toBeGreaterThan(0);
    }
  });

  test("templates have unique names", () => {
    const names = FLOW_TEMPLATES.map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});
