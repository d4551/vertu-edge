/*
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.google.ai.edge.gallery

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import com.google.ai.edge.gallery.common.applyAppLocale
import com.google.ai.edge.gallery.common.normalizeAppLocaleTag
import com.google.ai.edge.gallery.data.DataStoreRepository
import com.google.ai.edge.gallery.ui.theme.ThemeSettings
import com.google.firebase.FirebaseApp
import androidx.work.Configuration
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import javax.inject.Inject

@HiltAndroidApp
class GalleryApplication : Application(), Configuration.Provider {

  @Inject lateinit var dataStoreRepository: DataStoreRepository
  @Inject lateinit var hiltWorkerFactory: HiltWorkerFactory
  private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

  override fun onCreate() {
    super.onCreate()

    runBlocking {
      applyAppLocale(normalizeAppLocaleTag(dataStoreRepository.readAppLocale()))
    }

    // Load saved theme asynchronously to avoid blocking app startup.
    appScope.launch {
      ThemeSettings.themeOverride.value = dataStoreRepository.readTheme()
    }

    FirebaseApp.initializeApp(this)
  }

  override val workManagerConfiguration: Configuration
    get() =
      Configuration.Builder().setWorkerFactory(hiltWorkerFactory).build()
}
