import Testing
@testable import VertuEdgeDriver

@Suite("ModelSourceDescriptor selection")
struct ModelSourceDescriptorSelectionTests {
  private let sources: [ModelSourceDescriptor] = [
    .init(
      id: "huggingface",
      displayName: "Hugging Face",
      description: nil,
      modelRefPlaceholder: "owner/model",
      modelRefHint: nil,
      modelRefValidation: "hf",
      canonicalHost: "huggingface.co",
      ramalamaTransportPrefix: "huggingface://",
      aliases: ["hf"],
      enforceAllowlist: true
    ),
    .init(
      id: "ollama",
      displayName: "Ollama",
      description: nil,
      modelRefPlaceholder: "model",
      modelRefHint: nil,
      modelRefValidation: "ollama",
      canonicalHost: nil,
      ramalamaTransportPrefix: nil,
      aliases: ["local"],
      enforceAllowlist: false
    )
  ]

  @Test("resolves direct model source ids case-insensitively")
  func resolvesDirectIds() {
    let resolved = sources.resolveModelSourceId(
      candidate: "HUGGINGFACE",
      fallback: "ollama",
      canonicalFallback: "ollama"
    )

    #expect(resolved == "huggingface")
  }

  @Test("resolves model source aliases before fallback values")
  func resolvesAliases() {
    let resolved = sources.resolveModelSourceId(
      candidate: "local",
      fallback: "huggingface",
      canonicalFallback: "huggingface"
    )

    #expect(resolved == "ollama")
  }

  @Test("uses canonical fallback when candidate and fallback are unavailable")
  func usesCanonicalFallback() {
    let resolved = sources.resolveModelSourceId(
      candidate: "missing",
      fallback: "also-missing",
      canonicalFallback: "hf"
    )

    #expect(resolved == "huggingface")
  }

  @Test("returns first non-empty id when no fallback matches")
  func returnsFirstOptionWhenFallbacksDoNotMatch() {
    let resolved = sources.resolveModelSourceId(
      candidate: "",
      fallback: "",
      canonicalFallback: ""
    )

    #expect(resolved == "huggingface")
  }

  @Test("returns fallback string when option list is empty")
  func returnsFallbackWhenNoOptionsExist() {
    let resolved = [ModelSourceDescriptor]().resolveModelSourceId(
      candidate: "",
      fallback: "ollama",
      canonicalFallback: ""
    )

    #expect(resolved == "ollama")
  }
}
