package com.vertu.edge.ui

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.vertu.edge.ui.screens.FlowRunnerScreen
import com.vertu.edge.ui.screens.HomeScreen
import com.vertu.edge.ui.screens.ModelDownloadScreen

sealed class Screen(val route: String) {
    data object Home : Screen("home")
    data object FlowRunner : Screen("flow_runner")
    data object ModelDownload : Screen("model_download")
}

@Composable
fun VertuEdgeApp() {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = Screen.Home.route) {
        composable(Screen.Home.route) {
            HomeScreen(
                onNavigateToFlowRunner = { navController.navigate(Screen.FlowRunner.route) },
                onNavigateToModelDownload = { navController.navigate(Screen.ModelDownload.route) }
            )
        }
        composable(Screen.FlowRunner.route) {
            FlowRunnerScreen(onBack = { navController.popBackStack() })
        }
        composable(Screen.ModelDownload.route) {
            ModelDownloadScreen(onBack = { navController.popBackStack() })
        }
    }
}
