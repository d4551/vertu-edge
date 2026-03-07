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

package com.google.ai.edge.gallery.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

/**
 * Vertu brand shape tokens — single source for Android.
 * Must match: shared/brand-tokens.json, iOS VertuTheme.Shape, web brand-overrides.css.
 */
object VertuShape {
    /** Large panel containers — 28dp */
    val Panel = RoundedCornerShape(28.dp)
    /** Text inputs, selectors — 24dp */
    val Input = RoundedCornerShape(24.dp)
    /** Chat bubbles, state cards — 22dp */
    val Bubble = RoundedCornerShape(22.dp)
    /** Buttons, text fields — 18dp */
    val Button = RoundedCornerShape(18.dp)
    /** Chips — fully rounded */
    val Chip = RoundedCornerShape(999.dp)
}
