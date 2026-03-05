import { parseMaestroFlowYaml, normalizeFlowDocument } from "../../../contracts/flow-parser";
import type { FlowV1 } from "../../../contracts/flow-contracts";

/**
 * Shared FlowV1 normalization contract.
 */
export { normalizeFlowDocument };

/**
 * Normalize and validate flow YAML using the shared parser contract.
 */
export function normalizeFlowYaml(rawYaml: string): FlowV1 {
  return parseMaestroFlowYaml(rawYaml);
}
