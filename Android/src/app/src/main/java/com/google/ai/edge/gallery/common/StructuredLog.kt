/*
 * Copyright 2026 Google LLC
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

package com.google.ai.edge.gallery.common

import android.util.Log

/** Structured key/value logging helper for runtime and telemetry paths. */
internal object StructuredLog {
  fun d(tag: String, event: String, vararg fields: Pair<String, Any?>) {
    Log.d(tag, format(event = event, fields = fields))
  }

  fun w(tag: String, event: String, vararg fields: Pair<String, Any?>) {
    Log.w(tag, format(event = event, fields = fields))
  }

  fun e(tag: String, event: String, throwable: Throwable? = null, vararg fields: Pair<String, Any?>) {
    Log.e(tag, format(event = event, fields = fields), throwable)
  }

  private fun format(event: String, fields: Array<out Pair<String, Any?>>): String {
    val payload = buildList {
      add("event=${escape(event)}")
      for ((key, value) in fields) {
        add("${escape(key)}=${escape(value?.toString() ?: "null")}")
      }
    }
    return payload.joinToString(" ")
  }

  private fun escape(value: String): String {
    return value.replace("\\", "\\\\").replace(" ", "_").replace("\n", "\\n")
  }
}
