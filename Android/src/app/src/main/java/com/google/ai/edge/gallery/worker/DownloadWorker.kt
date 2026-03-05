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

package com.google.ai.edge.gallery.worker

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.google.ai.edge.gallery.data.HuggingFaceModelManager
import com.google.ai.edge.gallery.data.KEY_MODEL_COMMIT_HASH
import com.google.ai.edge.gallery.data.KEY_MODEL_DOWNLOAD_ACCESS_TOKEN
import com.google.ai.edge.gallery.data.KEY_MODEL_DOWNLOAD_ERROR_MESSAGE
import com.google.ai.edge.gallery.data.KEY_MODEL_DOWNLOAD_FILE_NAME
import com.google.ai.edge.gallery.data.KEY_MODEL_DOWNLOAD_MODEL_DIR
import com.google.ai.edge.gallery.data.KEY_MODEL_DOWNLOAD_RATE
import com.google.ai.edge.gallery.data.KEY_MODEL_DOWNLOAD_RECEIVED_BYTES
import com.google.ai.edge.gallery.data.KEY_MODEL_DOWNLOAD_REMAINING_MS
import com.google.ai.edge.gallery.data.KEY_MODEL_EXTRA_DATA_DOWNLOAD_FILE_NAMES
import com.google.ai.edge.gallery.data.KEY_MODEL_EXTRA_DATA_URLS
import com.google.ai.edge.gallery.data.KEY_MODEL_IS_ZIP
import com.google.ai.edge.gallery.data.KEY_MODEL_NAME
import com.google.ai.edge.gallery.data.KEY_MODEL_START_UNZIPPING
import com.google.ai.edge.gallery.data.KEY_MODEL_TOTAL_BYTES
import com.google.ai.edge.gallery.data.KEY_MODEL_UNZIPPED_DIR
import com.google.ai.edge.gallery.data.KEY_MODEL_URL
import com.google.ai.edge.gallery.data.Model
import com.google.ai.edge.gallery.data.ModelDownloadResult
import com.google.ai.edge.gallery.R
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import kotlin.math.min
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val TAG = "AGDownloadWorker"

private const val FOREGROUND_NOTIFICATION_CHANNEL_ID = "model_download_channel_foreground"
private var channelCreated = false

private data class DownloadFileSpec(val url: String, val fileName: String, val isPrimary: Boolean)

@HiltWorker
class DownloadWorker
@AssistedInject
constructor(
  @Assisted context: Context,
  @Assisted params: WorkerParameters,
  private val huggingFaceModelManager: HuggingFaceModelManager,
) : CoroutineWorker(context, params) {
  private val notificationManager =
    context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  private val notificationId: Int = params.id.hashCode()

  init {
    if (!channelCreated) {
      // Create a notification channel for showing notifications for model downloading progress.
      val channel =
        NotificationChannel(
            FOREGROUND_NOTIFICATION_CHANNEL_ID,
            "Model Downloading",
            // Make it silent.
            NotificationManager.IMPORTANCE_LOW,
          )
          .apply { description = "Notifications for model downloading" }
      notificationManager.createNotificationChannel(channel)
      channelCreated = true
    }
  }

  override suspend fun doWork(): Result {
    val fileUrl = inputData.getString(KEY_MODEL_URL)
    val fileName = inputData.getString(KEY_MODEL_DOWNLOAD_FILE_NAME)
    val modelName = inputData.getString(KEY_MODEL_NAME) ?: "Model"
    val modelDir = inputData.getString(KEY_MODEL_DOWNLOAD_MODEL_DIR) ?: ""
    val version = inputData.getString(KEY_MODEL_COMMIT_HASH) ?: ""
    val totalBytes = inputData.getLong(KEY_MODEL_TOTAL_BYTES, 0L)
    val isZip = inputData.getBoolean(KEY_MODEL_IS_ZIP, false)
    val unzippedDir = inputData.getString(KEY_MODEL_UNZIPPED_DIR)
    val accessToken = inputData.getString(KEY_MODEL_DOWNLOAD_ACCESS_TOKEN)
    val extraDataFileUrls = inputData.getString(KEY_MODEL_EXTRA_DATA_URLS)?.split(",") ?: listOf()
    val extraDataFileNames =
      inputData.getString(KEY_MODEL_EXTRA_DATA_DOWNLOAD_FILE_NAMES)?.split(",") ?: listOf()

    return withContext(Dispatchers.IO) {
      if (fileUrl == null || fileName == null) {
        return@withContext failureResult("Missing modelUrl or modelFileName input")
      }

      val externalFilesDir = applicationContext.getExternalFilesDir(null) ?: applicationContext.filesDir
      try {
        setForeground(createForegroundInfo(progress = 0, modelName = modelName))

        val downloadSpecs = buildDownloadSpecs(fileUrl, fileName, extraDataFileUrls, extraDataFileNames)
        val outputBaseDir = File(externalFilesDir, listOf(modelDir, version).joinToString(File.separator))
        if (!outputBaseDir.exists()) {
          outputBaseDir.mkdirs()
        }

        Log.d(TAG, "Downloading ${downloadSpecs.size} file(s) for model '$modelName'")
        var downloadedBytes = 0L
        val downloadSpeedBytes = mutableListOf<Long>()
        val downloadSpeedLatency = mutableListOf<Long>()

        var mainModelFile: File? = null

        for ((index, spec) in downloadSpecs.withIndex()) {
          val destinationFile = File(outputBaseDir, spec.fileName)
          val modelForDownload =
            createDownloadModel(
              name = modelName,
              fileName = spec.fileName,
              url = spec.url,
              dirVersion = version,
              isPrimary = spec.isPrimary,
              isZip = isZip && index == 0 && spec.isPrimary,
              totalBytes = if (spec.isPrimary) totalBytes else 0L,
            )

          if (index == 0) {
            mainModelFile = destinationFile
          }

          var lastSetProgressTs = 0L
          var bytesSinceLastSetProgress = 0L
          var previousReceivedBytes = 0L
          val bytesDownloadedBeforeThisFile = downloadedBytes

          val result = huggingFaceModelManager.downloadModel(
            model = modelForDownload,
            destination = destinationFile,
            token = accessToken,
            onProgress = { progress ->
              val fileDownloadedBytes = progress.receivedBytes
              val incrementalBytes = maxOf(0L, fileDownloadedBytes - previousReceivedBytes)
              previousReceivedBytes = fileDownloadedBytes
              val totalDownloaded = bytesDownloadedBeforeThisFile + fileDownloadedBytes

              bytesSinceLastSetProgress += incrementalBytes
              downloadedBytes = totalDownloaded
              val now = System.currentTimeMillis()
              if (now - lastSetProgressTs > 200) {
                var bytesPerMs = 0f
                if (lastSetProgressTs != 0L) {
                  if (downloadSpeedBytes.size == 5) {
                    downloadSpeedBytes.removeAt(0)
                  }
                  if (downloadSpeedLatency.size == 5) {
                    downloadSpeedLatency.removeAt(0)
                  }
                  downloadSpeedBytes.add(bytesSinceLastSetProgress)
                  downloadSpeedLatency.add(now - lastSetProgressTs)

                  if (downloadSpeedLatency.sum() > 0L) {
                    bytesPerMs = downloadSpeedBytes.sum().toFloat() / downloadSpeedLatency.sum()
                  }
                  bytesSinceLastSetProgress = 0L
                }

                var remainingMs = 0f
                if (bytesPerMs > 0f && totalBytes > 0L) {
                  remainingMs = (totalBytes - totalDownloaded) / bytesPerMs
                }

                val safeTotalBytes = maxOf(totalBytes, 1L)
                val progressPercent = ((totalDownloaded * 100) / safeTotalBytes).toInt()
                val rateBytesPerSecond = (bytesPerMs * 1000).toLong()
                setProgress(
                  Data.Builder()
                    .putLong(KEY_MODEL_DOWNLOAD_RECEIVED_BYTES, downloadedBytes)
                    .putLong(KEY_MODEL_DOWNLOAD_RATE, rateBytesPerSecond)
                    .putLong(KEY_MODEL_DOWNLOAD_REMAINING_MS, remainingMs.toLong())
                    .build()
                )
                setForeground(
                  createForegroundInfo(progress = min(progressPercent, 100), modelName = modelName)
                )
                Log.d(TAG, "downloadedBytes: $downloadedBytes, rateBps: $rateBytesPerSecond")
                lastSetProgressTs = now
              }
            },
          )

          when (result) {
            is ModelDownloadResult.Success -> {
              downloadedBytes = bytesDownloadedBeforeThisFile + result.file.length()
              setProgress(
                workDataOf(
                  KEY_MODEL_DOWNLOAD_RECEIVED_BYTES to downloadedBytes,
                  KEY_MODEL_DOWNLOAD_RATE to 0L,
                  KEY_MODEL_DOWNLOAD_REMAINING_MS to 0L,
                )
              )
            }

            is ModelDownloadResult.Failure -> {
              return@withContext failureResult("${result.code}: ${result.message}")
            }
          }
        }

        if (isZip && unzippedDir != null && mainModelFile != null) {
          unzipModelFile(
            mainModelFile = mainModelFile,
            outputBaseDir = outputBaseDir,
            unzippedDir = unzippedDir,
          )
        }

        Result.success()
      } catch (e: Exception) {
        Log.e(TAG, "Download failed", e)
        failureResult(e.message ?: "Unknown download error")
      }
    }
  }

  override suspend fun getForegroundInfo(): ForegroundInfo {
    val modelName = inputData.getString(KEY_MODEL_NAME) ?: "Model"
    return createForegroundInfo(progress = 0, modelName = modelName)
  }

  private fun createDownloadModel(
    name: String,
    fileName: String,
    url: String,
    dirVersion: String,
    isPrimary: Boolean,
    isZip: Boolean,
    totalBytes: Long,
  ): Model {
    return Model(
      name = name,
      url = url,
      downloadFileName = fileName,
      sizeInBytes = if (isPrimary) totalBytes else 0L,
      version = dirVersion,
      isZip = isZip,
    )
  }

  private fun buildDownloadSpecs(
    fileUrl: String,
    fileName: String,
    extraDataFileUrls: List<String>,
    extraDataFileNames: List<String>,
  ): List<DownloadFileSpec> {
    val specs = mutableListOf<DownloadFileSpec>()
    specs.add(DownloadFileSpec(url = fileUrl, fileName = fileName, isPrimary = true))

    val maxExtraFiles = min(extraDataFileUrls.size, extraDataFileNames.size)
    for (index in 0 until maxExtraFiles) {
      specs.add(
        DownloadFileSpec(
          url = extraDataFileUrls[index],
          fileName = extraDataFileNames[index],
          isPrimary = false,
        )
      )
    }
    return specs
  }

  private suspend fun unzipModelFile(
    mainModelFile: File,
    outputBaseDir: File,
    unzippedDir: String,
  ) {
    setProgress(Data.Builder().putBoolean(KEY_MODEL_START_UNZIPPING, true).build())

    val destinationDir =
      File(outputBaseDir, unzippedDir).apply {
        if (!exists()) {
          mkdirs()
        }
      }

    val buffer = ByteArray(4096)
    val zipIn = ZipInputStream(BufferedInputStream(FileInputStream(mainModelFile)))
    zipIn.use { zip ->
      while (true) {
        val zipEntry = zip.nextEntry ?: break
        val outputPath = File(destinationDir, zipEntry.name)
        try {
          if (zipEntry.isDirectory) {
            outputPath.mkdirs()
          } else {
            outputPath.parentFile?.mkdirs()
            FileOutputStream(outputPath).use { output ->
              var length: Int
              while (zip.read(buffer).also { length = it } > 0) {
                output.write(buffer, 0, length)
              }
            }
          }
        } finally {
          zip.closeEntry()
        }
      }
    }

    mainModelFile.delete()
  }

  private fun failureResult(message: String): Result {
    Log.e(TAG, "worker failure: $message")
    return Result.failure(workDataOf(KEY_MODEL_DOWNLOAD_ERROR_MESSAGE to message))
  }

  /**
   * Creates a [ForegroundInfo] object for the download worker's ongoing notification. This
   * notification is used to keep the worker running in the foreground, indicating to the user that
   * an active download is in progress.
   */
  private fun createForegroundInfo(progress: Int, modelName: String? = null): ForegroundInfo {
    val title =
      if (modelName != null) {
        applicationContext.getString(R.string.downloading_model_name, modelName)
      } else {
        applicationContext.getString(R.string.downloading_model)
      }
    val content = applicationContext.getString(R.string.downloading_in_progress, progress)

    val intent =
      Intent(applicationContext, Class.forName("com.google.ai.edge.gallery.MainActivity")).apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
      }
    val pendingIntent =
      PendingIntent.getActivity(
        applicationContext,
        0,
        intent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )

    val notification =
      NotificationCompat.Builder(applicationContext, FOREGROUND_NOTIFICATION_CHANNEL_ID)
        .setContentTitle(title)
        .setContentText(content)
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setOngoing(true)
        .setProgress(100, progress, false)
        .setContentIntent(pendingIntent)
        .build()

    return ForegroundInfo(
      notificationId,
      notification,
      ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
    )
  }
}
