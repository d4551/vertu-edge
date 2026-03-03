package com.vertu.edge.rpa

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class FlowRunnerViewModel @Inject constructor(
    private val flowEngine: VertuFlowEngine
) : ViewModel() {

    private val _state = MutableStateFlow<FlowExecutionState>(FlowExecutionState.Idle)
    val state: StateFlow<FlowExecutionState> = _state

    fun runFlow(yaml: String) {
        viewModelScope.launch {
            _state.value = FlowExecutionState.Running
            _state.value = when (val result = flowEngine.execute(yaml)) {
                is FlowResult.Success -> FlowExecutionState.Success(result.logs)
                is FlowResult.Error -> FlowExecutionState.Error(result.message)
            }
        }
    }
}
