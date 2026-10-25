package com.byoky.app.data

/**
 * Brute-force protection for the master password: after 5 failed attempts
 * the next one waits 30 s, after 10 five minutes, after 15 half an hour.
 *
 * Durations run on a monotonic clock (`SystemClock.elapsedRealtime`), so
 * moving the system time forward doesn't end a lockout. That clock restarts
 * at boot; a lockout found after a reboot starts its full duration again.
 * The failure counter is persisted, and an attempt is counted before the
 * password is checked, so killing the app mid-check doesn't make it free.
 *
 * Thread-safe; pure, unit-tested.
 */
class UnlockThrottle(
    private val store: Store,
    /** Monotonic milliseconds since boot. */
    private val elapsed: () -> Long,
    /** Boot counter (`Settings.Global.BOOT_COUNT`), or null if unavailable. */
    private val bootCount: () -> Int?,
) {
    /** Synchronous persistence; writes must be on disk when [write] returns. */
    interface Store {
        fun getInt(key: String, default: Int): Int
        fun getLong(key: String, default: Long): Long
        fun write(ints: Map<String, Int> = emptyMap(), longs: Map<String, Long> = emptyMap())
    }

    /** Milliseconds until the next attempt is allowed; 0 when it is allowed now. */
    @Synchronized fun remainingMs(): Long {
        val duration = store.getLong(DURATION, 0)
        if (duration <= 0) return 0
        val start = store.getLong(START, 0)
        val boot = store.getInt(BOOT, NO_BOOT)
        val now = elapsed()
        val currentBoot = bootCount()
        val rebooted = now < start || (currentBoot != null && boot != NO_BOOT && currentBoot != boot)
        if (rebooted) {
            store.write(ints = mapOf(BOOT to (currentBoot ?: NO_BOOT)), longs = mapOf(START to now))
            return duration
        }
        val remaining = start + duration - now
        if (remaining > 0) return remaining
        store.write(longs = mapOf(DURATION to 0L))
        return 0
    }

    /** Count an attempt before the password is checked. */
    @Synchronized fun beginAttempt() {
        store.write(ints = mapOf(ATTEMPTS to store.getInt(ATTEMPTS, 0) + 1))
    }

    /** The attempt failed: start a lockout if the count calls for one. */
    @Synchronized fun recordFailure() {
        val duration = lockoutDuration(store.getInt(ATTEMPTS, 0)) ?: return
        startLockout(duration)
    }

    @Synchronized fun reset() {
        store.write(ints = mapOf(ATTEMPTS to 0), longs = mapOf(DURATION to 0L))
    }

    /** Carry over a lockout stored as a wall-clock end time by older builds. */
    @Synchronized fun migrateWallClockLockout(endTime: Long, wallNow: Long) {
        if (endTime <= wallNow) return
        startLockout(minOf(endTime - wallNow, MAX_LOCKOUT))
    }

    private fun startLockout(duration: Long) {
        store.write(
            ints = mapOf(BOOT to (bootCount() ?: NO_BOOT)),
            longs = mapOf(DURATION to duration, START to elapsed()),
        )
    }

    companion object {
        const val ATTEMPTS = "failedUnlockAttempts"
        const val DURATION = "lockoutDurationMs"
        const val START = "lockoutStartElapsed"
        const val BOOT = "lockoutBootCount"
        private const val NO_BOOT = -1
        private const val MAX_LOCKOUT = 1_800_000L

        fun lockoutDuration(attempts: Int): Long? = when {
            attempts < 5 -> null
            attempts < 10 -> 30_000L
            attempts < 15 -> 300_000L
            else -> MAX_LOCKOUT
        }
    }
}
