package com.vertu.edge.huggingface

import android.content.Context
import android.util.Log
import com.vertu.edge.common.AppConstants
import com.vertu.edge.common.ProjectConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class HuggingFaceRepository @Inject constructor(
    private val api: HuggingFaceApi,
    private val context: Context,
    private val okHttpClient: OkHttpClient
) {
    private val tag = "HuggingFaceRepository"

    suspend fun searchModels(query: String): Result<List<ModelInfo>> = runCatching {
        withContext(Dispatchers.IO) {
            val searchTerm = if (query.isBlank()) "litertlm" else query
            api.searchModels(searchTerm).map { hfModel ->
                ModelInfo(
                    id = hfModel.id,
                    name = hfModel.modelId ?: hfModel.id,
                    description = hfModel.tags.joinToString(", ").ifEmpty { "LiteRT model" },
                    downloadUrl = "${AppConstants.HUGGINGFACE_API_BASE_URL}${hfModel.id}/resolve/main/model.litertlm",
                    tags = hfModel.tags
                )
            }
        }
    }

    suspend fun downloadModel(
        model: ModelInfo,
        onProgress: (Float) -> Unit
    ): Result<String> = runCatching {
        withContext(Dispatchers.IO) {
            val cacheDir = File(context.cacheDir, AppConstants.MODEL_CACHE_DIR).also { it.mkdirs() }
            val outputFile = File(cacheDir, "${model.id.replace("/", "_")}.litertlm")

            if (outputFile.exists()) {
                Log.d(tag, "Model already cached: ${outputFile.absolutePath}")
                return@withContext outputFile.absolutePath
            }

            val request = Request.Builder()
                .url(model.downloadUrl)
                .build()

            val response = okHttpClient.newCall(request).execute()
            if (!response.isSuccessful) {
                error("Download failed: HTTP ${response.code}")
            }

            val body = response.body ?: error("Empty response body")
            val totalBytes = body.contentLength()

            outputFile.outputStream().use { out ->
                body.byteStream().use { input ->
                    val buffer = ByteArray(8192)
                    var bytesRead = 0L
                    var len: Int
                    while (input.read(buffer).also { len = it } != -1) {
                        out.write(buffer, 0, len)
                        bytesRead += len
                        if (totalBytes > 0) {
                            onProgress(bytesRead.toFloat() / totalBytes.toFloat())
                        }
                    }
                }
            }

            Log.d(tag, "Model downloaded: ${outputFile.absolutePath}")
            outputFile.absolutePath
        }
    }

    fun getLocalModels(): List<ModelInfo> {
        val cacheDir = File(context.cacheDir, AppConstants.MODEL_CACHE_DIR)
        if (!cacheDir.exists()) return emptyList()
        return cacheDir.listFiles()
            ?.filter { it.name.endsWith(ProjectConfig.LITERT_MODEL_EXTENSION) }
            ?.map { file ->
                val name = file.nameWithoutExtension.replace("_", "/")
                ModelInfo(
                    id = name,
                    name = name,
                    description = "Local model",
                    sizeStr = formatFileSize(file.length()),
                    downloadUrl = file.absolutePath
                )
            } ?: emptyList()
    }

    private fun formatFileSize(bytes: Long): String = when {
        bytes >= 1_073_741_824 -> "%.1f GB".format(bytes / 1_073_741_824.0)
        bytes >= 1_048_576 -> "%.1f MB".format(bytes / 1_048_576.0)
        bytes >= 1024 -> "%.1f KB".format(bytes / 1024.0)
        else -> "$bytes B"
    }
}
