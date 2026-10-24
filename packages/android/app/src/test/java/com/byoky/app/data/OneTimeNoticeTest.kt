package com.byoky.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OneTimeNoticeTest {

    /** Stands in for the persisted flag in SharedPreferences, shared across "launches". */
    private class Flag(var pending: Boolean) {
        var clears = 0
        fun notice() = OneTimeNotice(isPending = { pending }, clearPending = { pending = false; clears++ })
    }

    @Test
    fun shownOnceThenGoneOnTheNextLaunchEvenWithoutDismissing() {
        val flag = Flag(pending = true)

        val firstLaunch = flag.notice().apply { load() }
        assertTrue(firstLaunch.visible.value)
        firstLaunch.markShown()
        // Still up for the rest of this session…
        assertTrue(firstLaunch.visible.value)
        assertFalse(flag.pending)

        // …but a cold restart doesn't bring it back.
        val secondLaunch = flag.notice().apply { load() }
        assertFalse(secondLaunch.visible.value)
    }

    @Test
    fun notMarkedSeenUntilItIsActuallyShown() {
        val flag = Flag(pending = true)
        // Launched but never unlocked: the notice was never on screen.
        flag.notice().markShown()
        assertTrue(flag.pending)
        assertTrue(flag.notice().apply { load() }.visible.value)
    }

    @Test
    fun dismissHidesItForGood() {
        val flag = Flag(pending = true)
        val notice = flag.notice().apply { load() }
        notice.dismiss()
        assertFalse(notice.visible.value)
        assertFalse(flag.notice().apply { load() }.visible.value)
    }

    @Test
    fun installsThatNeverUsedRetiredFeaturesNeverSeeIt() {
        val flag = Flag(pending = false)
        val notice = flag.notice().apply { load() }
        notice.markShown()
        assertFalse(notice.visible.value)
        assertEquals(0, flag.clears)
    }
}
