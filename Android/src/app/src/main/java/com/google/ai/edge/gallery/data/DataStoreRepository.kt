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

package com.google.ai.edge.gallery.data

import androidx.datastore.core.DataStore
import com.google.ai.edge.gallery.proto.AccessTokenData
import com.google.ai.edge.gallery.proto.BenchmarkResult
import com.google.ai.edge.gallery.proto.BenchmarkResults
import com.google.ai.edge.gallery.proto.Cutout
import com.google.ai.edge.gallery.proto.CutoutCollection
import com.google.ai.edge.gallery.proto.ImportedModel
import com.google.ai.edge.gallery.proto.Settings
import com.google.ai.edge.gallery.proto.Theme
import com.google.ai.edge.gallery.proto.UserData
import kotlinx.coroutines.flow.first

interface DataStoreRepository {
  suspend fun saveTextInputHistory(history: List<String>)

  suspend fun readTextInputHistory(): List<String>

  suspend fun saveTheme(theme: Theme)

  suspend fun readTheme(): Theme

  suspend fun saveAccessTokenData(accessToken: String, refreshToken: String, expiresAt: Long)

  suspend fun clearAccessTokenData()

  suspend fun readAccessTokenData(): AccessTokenData?

  suspend fun saveImportedModels(importedModels: List<ImportedModel>)

  suspend fun readImportedModels(): List<ImportedModel>

  suspend fun isTosAccepted(): Boolean

  suspend fun acceptTos()

  suspend fun isGemmaTermsOfUseAccepted(): Boolean

  suspend fun acceptGemmaTermsOfUse()

  suspend fun getHasRunTinyGarden(): Boolean

  suspend fun setHasRunTinyGarden(hasRun: Boolean)

  suspend fun addCutout(cutout: Cutout)

  suspend fun getAllCutouts(): List<Cutout>

  suspend fun setCutout(newCutout: Cutout)

  suspend fun setCutouts(cutouts: List<Cutout>)

  suspend fun setHasSeenBenchmarkComparisonHelp(seen: Boolean)

  suspend fun getHasSeenBenchmarkComparisonHelp(): Boolean

  suspend fun addBenchmarkResult(result: BenchmarkResult)

  suspend fun getAllBenchmarkResults(): List<BenchmarkResult>

  suspend fun deleteBenchmarkResult(index: Int)
}

/** Repository for managing data using Proto DataStore. */
class DefaultDataStoreRepository(
  private val dataStore: DataStore<Settings>,
  private val userDataDataStore: DataStore<UserData>,
  private val cutoutDataStore: DataStore<CutoutCollection>,
  private val benchmarkResultsDataStore: DataStore<BenchmarkResults>,
) : DataStoreRepository {
  override suspend fun saveTextInputHistory(history: List<String>) {
    dataStore.updateData { settings ->
      settings.toBuilder().clearTextInputHistory().addAllTextInputHistory(history).build()
    }
  }

  override suspend fun readTextInputHistory(): List<String> {
    return dataStore.data.first().textInputHistoryList
  }

  override suspend fun saveTheme(theme: Theme) {
    dataStore.updateData { settings -> settings.toBuilder().setTheme(theme).build() }
  }

  override suspend fun readTheme(): Theme {
    val curTheme = dataStore.data.first().theme
    return if (curTheme == Theme.THEME_UNSPECIFIED) Theme.THEME_AUTO else curTheme
  }

  override suspend fun saveAccessTokenData(
    accessToken: String,
    refreshToken: String,
    expiresAt: Long,
  ) {
    dataStore.updateData { settings ->
      settings.toBuilder().setAccessTokenData(AccessTokenData.getDefaultInstance()).build()
    }
    userDataDataStore.updateData { userData ->
      userData
        .toBuilder()
        .setAccessTokenData(
          AccessTokenData.newBuilder()
            .setAccessToken(accessToken)
            .setRefreshToken(refreshToken)
            .setExpiresAtMs(expiresAt)
            .build()
        )
        .build()
    }
  }

  override suspend fun clearAccessTokenData() {
    dataStore.updateData { settings -> settings.toBuilder().clearAccessTokenData().build() }
    userDataDataStore.updateData { userData ->
      userData.toBuilder().clearAccessTokenData().build()
    }
  }

  override suspend fun readAccessTokenData(): AccessTokenData? {
    return userDataDataStore.data.first().accessTokenData
  }

  override suspend fun saveImportedModels(importedModels: List<ImportedModel>) {
    dataStore.updateData { settings ->
      settings.toBuilder().clearImportedModel().addAllImportedModel(importedModels).build()
    }
  }

  override suspend fun readImportedModels(): List<ImportedModel> {
    return dataStore.data.first().importedModelList
  }

  override suspend fun isTosAccepted(): Boolean {
    return dataStore.data.first().isTosAccepted
  }

  override suspend fun acceptTos() {
    dataStore.updateData { settings -> settings.toBuilder().setIsTosAccepted(true).build() }
  }

  override suspend fun isGemmaTermsOfUseAccepted(): Boolean {
    return dataStore.data.first().isGemmaTermsAccepted
  }

  override suspend fun acceptGemmaTermsOfUse() {
    dataStore.updateData { settings ->
      settings.toBuilder().setIsGemmaTermsAccepted(true).build()
    }
  }

  override suspend fun getHasRunTinyGarden(): Boolean {
    return dataStore.data.first().hasRunTinyGarden
  }

  override suspend fun setHasRunTinyGarden(hasRun: Boolean) {
    dataStore.updateData { settings -> settings.toBuilder().setHasRunTinyGarden(hasRun).build() }
  }

  override suspend fun addCutout(cutout: Cutout) {
    cutoutDataStore.updateData { cutouts -> cutouts.toBuilder().addCutout(cutout).build() }
  }

  override suspend fun getAllCutouts(): List<Cutout> {
    return cutoutDataStore.data.first().cutoutList
  }

  override suspend fun setCutout(newCutout: Cutout) {
    cutoutDataStore.updateData { cutouts ->
      var index = -1
      for (i in 0..<cutouts.cutoutCount) {
        val cutout = cutouts.cutoutList.get(i)
        if (cutout.id == newCutout.id) {
          index = i
          break
        }
      }
      if (index >= 0) {
        cutouts.toBuilder().setCutout(index, newCutout).build()
      } else {
        cutouts
      }
    }
  }

  override suspend fun setCutouts(cutouts: List<Cutout>) {
    cutoutDataStore.updateData { CutoutCollection.newBuilder().addAllCutout(cutouts).build() }
  }

  override suspend fun setHasSeenBenchmarkComparisonHelp(seen: Boolean) {
    dataStore.updateData { settings ->
      settings.toBuilder().setHasSeenBenchmarkComparisonHelp(seen).build()
    }
  }

  override suspend fun getHasSeenBenchmarkComparisonHelp(): Boolean {
    return dataStore.data.first().hasSeenBenchmarkComparisonHelp
  }

  override suspend fun addBenchmarkResult(result: BenchmarkResult) {
    benchmarkResultsDataStore.updateData { results ->
      results.toBuilder().addResult(0, result).build()
    }
  }

  override suspend fun getAllBenchmarkResults(): List<BenchmarkResult> {
    return benchmarkResultsDataStore.data.first().resultList
  }

  override suspend fun deleteBenchmarkResult(index: Int) {
    benchmarkResultsDataStore.updateData { results ->
      results.toBuilder().removeResult(index).build()
    }
  }
}

