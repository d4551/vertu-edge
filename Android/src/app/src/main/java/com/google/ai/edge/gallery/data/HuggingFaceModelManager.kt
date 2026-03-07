package com.google.ai.edge.gallery.data

import com.google.ai.edge.gallery.common.StructuredLog
import java.io.File
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.security.MessageDigest
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

private const val TAG = "AGHfModelManager"

/** Download status payload used by resumable model downloads. */
data class ModelDownloadProgress(
  val correlationId: String,
  val receivedBytes: Long,
  val totalBytes: Long,
)

/** Typed result for model download and integrity verification. */
sealed class ModelDownloadResult {
  data class Success(val file: File, val correlationId: String) : ModelDownloadResult()

  data class Failure(
    val code: String,
    val message: String,
    val retryable: Boolean,
    val correlationId: String,
  ) : ModelDownloadResult()
}

/** Config for Hugging Face download boundaries and retries. */
data class HuggingFaceDownloadConfig(
  val connectionTimeoutMs: Int = 10_000,
  val readTimeoutMs: Int = 30_000,
  val maxAttempts: Int = 3,
  val initialBackoffMs: Long = 1_000,
  val maxBackoffMs: Long = 6_000,
)

/**
 * Downloads and verifies Hugging Face model files with resume support.
 *
 * This manager is intentionally standalone so it can be reused by WorkManager and future iOS/KMP
 * download adapters.
 */
class HuggingFaceModelManager(
  private val config: HuggingFaceDownloadConfig = HuggingFaceDownloadConfig(),
  private val nowMs: () -> Long = { System.currentTimeMillis() },
) {

  suspend fun downloadModel(
    model: Model,
    destination: File,
    token: String? = null,
    onProgress: suspend (ModelDownloadProgress) -> Unit = {},
  ): ModelDownloadResult {
    val correlationId = "hf-${model.normalizedName}-${nowMs()}"
    val tempFile = File("${destination.absolutePath}.part")
    val tempParentDir =
      requireNotNull(tempFile.parentFile) { "Temporary model path must have a parent directory." }

    if (!tempParentDir.exists()) {
      tempParentDir.mkdirs()
    }

    var backoffMs = config.initialBackoffMs
    repeat(config.maxAttempts) { attempt ->
      val attemptResult =
        withContext(Dispatchers.IO) {
          runCatching {
            downloadAttempt(
              model = model,
              tempFile = tempFile,
              destination = destination,
              token = token,
              correlationId = correlationId,
              onProgress = onProgress,
            )
          }
        }

      if (attemptResult.isSuccess) {
        return ModelDownloadResult.Success(file = destination, correlationId = correlationId)
      }

      val error = attemptResult.exceptionOrNull()
      val failure = toFailure(error = error, correlationId = correlationId, canRetry = attempt < config.maxAttempts - 1)
      StructuredLog.e(
        TAG,
        "hf_download_failed",
        error,
        "correlationId" to correlationId,
        "attempt" to (attempt + 1),
        "code" to failure.code,
        "retryable" to failure.retryable,
      )

      if (!failure.retryable) {
        return failure
      }

      delay(backoffMs)
      backoffMs = (backoffMs * 2).coerceAtMost(config.maxBackoffMs)
    }

    return ModelDownloadResult.Failure(
      code = "HF_DOWNLOAD_FAILED",
      message = "Retry budget exhausted",
      retryable = false,
      correlationId = correlationId,
    )
  }

  private suspend fun downloadAttempt(
    model: Model,
    tempFile: File,
    destination: File,
    token: String?,
    correlationId: String,
    onProgress: suspend (ModelDownloadProgress) -> Unit,
  ) {
    val existingBytes = if (tempFile.exists()) tempFile.length() else 0L
    val connection = (URL(model.url).openConnection() as HttpURLConnection)
    connection.connectTimeout = config.connectionTimeoutMs
    connection.readTimeout = config.readTimeoutMs
    connection.requestMethod = "GET"
    connection.setRequestProperty("Accept", "application/octet-stream")
    if (!token.isNullOrBlank()) {
      connection.setRequestProperty("Authorization", "Bearer $token")
    }
    if (existingBytes > 0L) {
      connection.setRequestProperty("Range", "bytes=$existingBytes-")
    }

    connection.connect()

    val acceptedStatus = connection.responseCode in listOf(200, 206)
    check(acceptedStatus) {
      "Unexpected response code ${connection.responseCode} from model host"
    }

    val contentLength = connection.contentLengthLong
    val totalBytes = if (contentLength > 0) contentLength + existingBytes else model.totalBytes

    RandomAccessFile(tempFile, "rw").use { output ->
      if (existingBytes > 0L) {
        output.seek(existingBytes)
      }

      connection.inputStream.use { input ->
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        var downloaded = existingBytes
        while (true) {
          currentCoroutineContext().ensureActive()
          val bytesRead = input.read(buffer)
          if (bytesRead <= 0) {
            break
          }
          output.write(buffer, 0, bytesRead)
          downloaded += bytesRead
          onProgress(
            ModelDownloadProgress(
              correlationId = correlationId,
              receivedBytes = downloaded,
              totalBytes = totalBytes,
            )
          )
        }
      }
    }

    if (model.sha256.isNotBlank()) {
      val actualDigest = computeSha256(tempFile)
      check(actualDigest.equals(model.sha256, ignoreCase = true)) {
        "Checksum mismatch for ${model.name}: expected ${model.sha256}, actual $actualDigest"
      }
    }

    if (destination.exists()) {
      destination.delete()
    }
    val renamed = tempFile.renameTo(destination)
    check(renamed) { "Failed to finalize model file for ${model.name}" }

    StructuredLog.d(
      TAG,
      "hf_download_succeeded",
      "correlationId" to correlationId,
      "model" to model.name,
      "bytes" to destination.length(),
    )
  }

  private fun computeSha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
      while (true) {
        val read = input.read(buffer)
        if (read <= 0) {
          break
        }
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString(separator = "") { "%02x".format(it) }
  }

  private fun toFailure(
    error: Throwable?,
    correlationId: String,
    canRetry: Boolean,
  ): ModelDownloadResult.Failure {
    val message = error?.message?.trim().orEmpty().ifBlank { "Unknown Hugging Face download failure" }
    val code =
      when {
        message.contains("401") || message.contains("403") -> "HF_UNAUTHORIZED"
        message.contains("404") -> "HF_MODEL_NOT_FOUND"
        message.contains("Checksum mismatch", ignoreCase = true) -> "HF_CHECKSUM_MISMATCH"
        message.contains("Failed to finalize", ignoreCase = true) -> "HF_IO_FAILURE"
        error is SocketTimeoutException || error is UnknownHostException -> "HF_TRANSPORT_FAILURE"
        else -> "HF_DOWNLOAD_FAILED"
      }
    val retryable = canRetry && isRetryable(error = error, message = message, code = code)
    return ModelDownloadResult.Failure(
      code = code,
      message = message,
      retryable = retryable,
      correlationId = correlationId,
    )
  }

  private fun isRetryable(error: Throwable?, message: String, code: String): Boolean {
    if (code == "HF_UNAUTHORIZED" || code == "HF_CHECKSUM_MISMATCH" || code == "HF_IO_FAILURE") {
      return false
    }
    if (error is SocketTimeoutException || error is UnknownHostException) {
      return true
    }
    return message.contains("408") ||
      message.contains("429") ||
      message.contains("500") ||
      message.contains("502") ||
      message.contains("503") ||
      message.contains("504")
  }
}
