package com.byoky.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

class UnlockThrottleTest {

    private val values = mutableMapOf<String, Any>()
    private val store = object : UnlockThrottle.Store {
        override fun getInt(key: String, default: Int) = values[key] as? Int ?: default
        override fun getLong(key: String, default: Long) = values[key] as? Long ?: default
        override fun write(ints: Map<String, Int>, longs: Map<String, Long>) {
            values.putAll(ints)
            values.putAll(longs)
        }
    }
    private var elapsed = 5_000_000L
    private var boot: Int? = 7
    private fun throttle() = UnlockThrottle(store, { elapsed }, { boot })

    private fun UnlockThrottle.fail(times: Int) = repeat(times) {
        beginAttempt()
        recordFailure()
    }

    @Test
    fun locksOutAfterFiveFailures() {
        val t = throttle()
        t.fail(4)
        assertEquals(0L, t.remainingMs())
        t.fail(1)
        assertEquals(30_000L, t.remainingMs())
        elapsed += 30_000
        assertEquals(0L, t.remainingMs())
        t.fail(5)
        assertEquals(300_000L, t.remainingMs())
    }

    @Test
    fun theWallClockPlaysNoPart() {
        // Only the monotonic clock is consulted: setting the system time
        // forward can't touch it, so the lockout still runs.
        val t = throttle()
        t.fail(5)
        elapsed += 10_000
        assertEquals(20_000L, t.remainingMs())
    }

    @Test
    fun aRebootRestartsTheFullLockout() {
        val t = throttle()
        t.fail(15)
        elapsed += 1_000_000
        assertEquals(800_000L, t.remainingMs())
        // Reboot: new boot count, monotonic clock back near zero.
        boot = 8
        elapsed = 60_000
        val afterReboot = throttle()
        assertEquals(1_800_000L, afterReboot.remainingMs())
        elapsed += 1_000
        assertEquals(1_799_000L, afterReboot.remainingMs())
    }

    @Test
    fun aRebootIsNoticedWithoutABootCounterToo() {
        boot = null
        val t = throttle()
        t.fail(5)
        elapsed = 10   // clock restarted
        assertEquals(30_000L, throttle().remainingMs())
    }

    @Test
    fun attemptsCountBeforeThePasswordIsChecked() {
        val t = throttle()
        repeat(4) { t.fail(1) }
        // The app is killed while checking the fifth: it still counted.
        t.beginAttempt()
        val restarted = throttle()
        restarted.beginAttempt()
        restarted.recordFailure()
        assertEquals(30_000L, restarted.remainingMs())
    }

    @Test
    fun successResetsTheCounter() {
        val t = throttle()
        t.fail(4)
        t.reset()
        t.fail(4)
        assertEquals(0L, t.remainingMs())
    }

    @Test
    fun carriesOverAWallClockLockoutFromOlderBuilds() {
        val t = throttle()
        t.migrateWallClockLockout(endTime = 1_000_000 + 120_000, wallNow = 1_000_000)
        assertEquals(120_000L, t.remainingMs())
        // A forged far-future end time is capped at the longest lockout.
        val u = UnlockThrottle(store, { elapsed }, { boot })
        u.migrateWallClockLockout(endTime = Long.MAX_VALUE, wallNow = 0)
        assertEquals(1_800_000L, u.remainingMs())
    }
}
