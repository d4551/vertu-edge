package com.vertu.edge.rpa

sealed class FlowExecutionState {
    data object Idle : FlowExecutionState()
    data object Running : FlowExecutionState()
    data class Success(val logs: List<String>) : FlowExecutionState()
    data class Error(val message: String) : FlowExecutionState()
}
