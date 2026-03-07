import {
  isSupportedDesktopBuildVariant,
  type DesktopBuildVariant,
} from "../contracts/flow-contracts";

/** Resolve the canonical desktop build variant for the active host or return `null` when unsupported. */
export function resolveDefaultDesktopBuildVariant(
  hostPlatform: string,
  hostArchitecture: string,
): DesktopBuildVariant | null {
  const normalizedOs =
    hostPlatform === "darwin"
      ? "darwin"
      : hostPlatform === "linux"
        ? "linux"
        : hostPlatform === "win32"
          ? "windows"
          : null;
  const normalizedArch =
    hostArchitecture === "x64" || hostArchitecture === "arm64"
      ? hostArchitecture
      : hostArchitecture === "amd64"
        ? "x64"
        : hostArchitecture === "aarch64"
          ? "arm64"
          : null;
  if (!normalizedOs || !normalizedArch) {
    return null;
  }
  const variant = `${normalizedOs}-${normalizedArch}`;
  return isSupportedDesktopBuildVariant(variant) ? variant : null;
}
