package com.vertu.edge.rpa.android

import com.vertu.edge.core.flow.CommandTarget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SelectorPriorityResolverTest {
  @Test
  fun selectorOrderFollowsContractPriority() {
    val selectors =
      SelectorPriorityResolver.orderedSelectors(
        CommandTarget(
          resourceId = "com.vertu.edge:id/submit",
          text = "Submit",
          contentDescription = "Submit button",
          x = 100,
          y = 200,
        )
      )

    assertEquals(3, selectors.size)
    assertTrue(selectors[0].toString().contains("RES"))
    assertTrue(selectors[1].toString().contains("TEXT"))
  }
}
