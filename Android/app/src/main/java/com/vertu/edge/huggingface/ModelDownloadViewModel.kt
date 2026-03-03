package com.vertu.edge.huggingface

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ModelDownloadViewModel @Inject constructor(
    private val repository: HuggingFaceRepository
) : ViewModel() {

    private val _models = MutableStateFlow<List<ModelInfo>>(emptyList())
    val models: StateFlow<List<ModelInfo>> = _models

    private val _downloadState = MutableStateFlow<DownloadState>(DownloadState.Idle)
    val downloadState: StateFlow<DownloadState> = _downloadState

    init {
        searchModels("")
    }

    fun searchModels(query: String) {
        viewModelScope.launch {
            repository.searchModels(query).onSuccess { results ->
                _models.value = results + repository.getLocalModels()
            }.onFailure {
                _models.value = repository.getLocalModels()
            }
        }
    }

    fun downloadModel(model: ModelInfo) {
        viewModelScope.launch {
            _downloadState.value = DownloadState.Downloading(model.name, 0f)
            repository.downloadModel(model) { progress ->
                _downloadState.value = DownloadState.Downloading(model.name, progress)
            }.onSuccess { path ->
                _downloadState.value = DownloadState.Completed(model.name, path)
            }.onFailure { e ->
                _downloadState.value = DownloadState.Error(e.message ?: "Download failed")
            }
        }
    }
}
