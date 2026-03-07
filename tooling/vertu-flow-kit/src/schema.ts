import { type JSONSchemaType, type ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FlowV1 } from "../../../contracts/flow-contracts";
import type {
  DeviceAiProtocolProfile,
  DeviceAiProtocolRunReport,
} from "../../../contracts/device-ai-protocol";

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
  /** Device AI protocol profile validator. */
  deviceAiProfile: ValidateFunction<DeviceAiProtocolProfile>;
  /** Device AI protocol run-report validator. */
  deviceAiReport: ValidateFunction<DeviceAiProtocolRunReport>;
}

/** Loads JSON schema validators from repository contract files. */
export function loadSchemaValidators(): SchemaValidators {
  const basePath = resolve(import.meta.dir, "..", "..", "..", "contracts");
  const flowSchemaPath = resolve(basePath, "flow-v1.schema.json");
  const modelSchemaPath = resolve(basePath, "model-manifest-v2.schema.json");
  const deviceAiSchemaPath = resolve(basePath, "device-ai-protocol.schema.json");

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const flowSchema = JSON.parse(readFileSync(flowSchemaPath, "utf-8"));
  const modelSchema = JSON.parse(readFileSync(modelSchemaPath, "utf-8")) as JSONSchemaType<ModelManifestV2>;
  const deviceAiSchema = JSON.parse(readFileSync(deviceAiSchemaPath, "utf-8")) as object;
  ajv.addSchema(deviceAiSchema);
  const deviceAiSchemaId = "https://vertu.edge/schemas/device-ai-protocol.schema.json";

  return {
    flow: ajv.compile<FlowV1>(flowSchema),
    modelManifest: ajv.compile<ModelManifestV2>(modelSchema),
    deviceAiProfile: ajv.compile<DeviceAiProtocolProfile>({
      $ref: `${deviceAiSchemaId}#/$defs/DeviceAiProtocolProfile`,
    }),
    deviceAiReport: ajv.compile<DeviceAiProtocolRunReport>({
      $ref: `${deviceAiSchemaId}#/$defs/DeviceAiProtocolRunReport`,
    }),
  };
}
