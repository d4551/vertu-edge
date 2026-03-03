package com.vertu.edge.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Download
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.vertu.edge.R
import com.vertu.edge.huggingface.DownloadState
import com.vertu.edge.huggingface.ModelDownloadViewModel
import com.vertu.edge.huggingface.ModelInfo

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModelDownloadScreen(
    onBack: () -> Unit,
    viewModel: ModelDownloadViewModel = hiltViewModel()
) {
    val models by viewModel.models.collectAsState()
    val downloadState by viewModel.downloadState.collectAsState()
    var searchQuery by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.model_download_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = {
                    searchQuery = it
                    viewModel.searchModels(it)
                },
                label = { Text(stringResource(R.string.search_models)) },
                modifier = Modifier.fillMaxWidth()
            )

            when (val ds = downloadState) {
                is DownloadState.Downloading -> {
                    LinearProgressIndicator(
                        progress = { ds.progress },
                        modifier = Modifier.fillMaxWidth()
                    )
                    Text(stringResource(R.string.downloading_model, ds.modelName))
                }
                is DownloadState.Error -> {
                    Text(
                        text = ds.message,
                        color = MaterialTheme.colorScheme.error
                    )
                }
                else -> {}
            }

            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(models) { model ->
                    ModelCard(model = model, onDownload = { viewModel.downloadModel(model) })
                }
            }
        }
    }
}

@Composable
private fun ModelCard(model: ModelInfo, onDownload: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(text = model.name, style = MaterialTheme.typography.titleMedium)
                Text(
                    text = model.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                model.sizeStr?.let {
                    Text(text = it, style = MaterialTheme.typography.labelSmall)
                }
            }
            IconButton(onClick = onDownload) {
                Icon(Icons.Filled.Download, contentDescription = "Download ${model.name}")
            }
        }
    }
}
