package com.vertu.edge

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.vertu.edge.ui.VertuEdgeApp
import com.vertu.edge.ui.theme.VertuEdgeTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            VertuEdgeTheme {
                VertuEdgeApp()
            }
        }
    }
}
