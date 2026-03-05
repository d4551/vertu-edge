import { type JSONSchemaType, type ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FlowV1 } from "./types";

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | { [key: string]: JsonValue } | JsonValue[];

interface ModelManifestDefaultConfig {
  [key: string]: JsonValue;
  topK?: number;
  topP?: number;
  temperature?: number;
  maxTokens?: number;
  accelerators?: string;
}

interface ModelManifestItem {
  name: string;
  modelId: string;
  modelFile: string;
  description: string;
  source?: "huggingface" | "local";
  sizeInBytes: number;
  estimatedPeakMemoryInBytes?: number;
  sha256?: string;
  commitHash?: string;
  version?: string;
  taskTypes: string[];
  defaultConfig?: ModelManifestDefaultConfig;
  [key: string]: JsonValue;
}

interface ModelManifestV2 {
  models: ModelManifestItem[];
}

/** Validation bundle for contracts consumed by CLI commands. */
export interface SchemaValidators {
  /** FlowV1 validator. */
  flow: ValidateFunction<FlowV1>;
  /** Model manifest v2 validator. */
  modelManifest: ValidateFunction<ModelManifestV2>;
}

/** Loads JSON schema validators from repository contract files. */
export function loadSchemaValidators(): SchemaValidators {
  const basePath = resolve(import.meta.dir, "..", "..", "..", "contracts");
  const flowSchemaPath = resolve(basePath, "flow-v1.schema.json");
  const modelSchemaPath = resolve(basePath, "model-manifest-v2.schema.json");

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const flowSchema = JSON.parse(readFileSync(flowSchemaPath, "utf-8"));
  const modelSchema = JSON.parse(readFileSync(modelSchemaPath, "utf-8")) as JSONSchemaType<ModelManifestV2>;

  return {
    flow: ajv.compile<FlowV1>(flowSchema),
    modelManifest: ajv.compile<ModelManifestV2>(modelSchema),
  };
}
