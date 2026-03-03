package com.vertu.edge.huggingface

data class ModelInfo(
    val id: String,
    val name: String,
    val description: String,
    val sizeStr: String? = null,
    val downloadUrl: String,
    val tags: List<String> = emptyList()
)

sealed class DownloadState {
    data object Idle : DownloadState()
    data class Downloading(val modelName: String, val progress: Float) : DownloadState()
    data class Completed(val modelName: String, val localPath: String) : DownloadState()
    data class Error(val message: String) : DownloadState()
}
