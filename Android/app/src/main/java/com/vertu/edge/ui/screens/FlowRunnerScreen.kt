package com.vertu.edge.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.vertu.edge.R
import com.vertu.edge.rpa.FlowExecutionState
import com.vertu.edge.rpa.FlowRunnerViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FlowRunnerScreen(
    onBack: () -> Unit,
    viewModel: FlowRunnerViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    var flowYaml by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.flow_runner_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { viewModel.runFlow(flowYaml) }) {
                Icon(Icons.Filled.PlayArrow, contentDescription = stringResource(R.string.run_flow))
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            OutlinedTextField(
                value = flowYaml,
                onValueChange = { flowYaml = it },
                label = { Text(stringResource(R.string.flow_yaml_label)) },
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                maxLines = 20
            )

            when (val s = state) {
                is FlowExecutionState.Idle -> {}
                is FlowExecutionState.Running -> {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                    Text(stringResource(R.string.flow_running))
                }
                is FlowExecutionState.Success -> {
                    Text(
                        text = stringResource(R.string.flow_success),
                        color = MaterialTheme.colorScheme.primary
                    )
                    LazyColumn {
                        items(s.logs) { log ->
                            Text(text = log, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
                is FlowExecutionState.Error -> {
                    Text(
                        text = s.message,
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }
        }
    }
}
