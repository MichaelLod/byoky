package com.byoky.app.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AutoLockTimerTest {

    private var clock = 1_000L
    private val timer = AutoLockTimer(timeoutMs = 60_000) { clock }

    @Test
    fun locksAfterTheTimeoutWhileInTheForeground() {
        timer.reset()
        clock += 59_999
        assertFalse(timer.isExpired())
        clock += 1
        assertTrue(timer.isExpired())
    }

    @Test
    fun activityRestartsTheTimeout() {
        timer.reset()
        clock += 50_000
        timer.noteActivity()
        clock += 50_000
        assertFalse(timer.isExpired())
    }

    @Test
    fun activityInTheBackgroundDoesNotKeepTheWalletOpen() {
        timer.reset()
        timer.enterBackground()
        clock += 30_000
        timer.noteActivity()
        clock += 30_000
        assertTrue(timer.isExpired())
        assertTrue(timer.enterForeground())
    }

    @Test
    fun returningInTimeCountsAsInteraction() {
        timer.reset()
        clock += 50_000
        timer.enterBackground()
        clock += 5_000
        assertFalse(timer.enterForeground())
        clock += 50_000
        assertFalse(timer.isExpired())
    }
}
