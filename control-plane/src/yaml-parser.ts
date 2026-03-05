import type { FlowV1 } from "../../contracts/flow-contracts";
import { parseMaestroFlowYaml } from "../../contracts/flow-parser";

/** Parse Maestro YAML into canonical FlowV1 command sequence. */
export function parseMaestroYaml(yamlString: string): FlowV1 {
  return parseMaestroFlowYaml(yamlString);
}
