package com.byoky.app.data

/**
 * When the unlocked wallet should lock itself: after [timeoutMs] without
 * interaction or wallet activity while the app is in the foreground, and
 * after [timeoutMs] in the background whatever happens there (a page left
 * running in the background can't keep the wallet open).
 *
 * [now] must be a monotonic clock (`SystemClock.elapsedRealtime`), so
 * changing the system time can't stretch or skip the timeout. Thread-safe;
 * pure, unit-tested.
 */
class AutoLockTimer(private val timeoutMs: Long, private val now: () -> Long) {
    private var lastActivity = now()
    private var backgroundSince: Long? = null

    /** The wallet was just unlocked: start counting from now. */
    @Synchronized fun reset() {
        lastActivity = now()
        backgroundSince = null
    }

    /** User interaction or a proxied request. Ignored while in the background. */
    @Synchronized fun noteActivity() {
        if (backgroundSince == null) lastActivity = now()
    }

    @Synchronized fun enterBackground() {
        if (backgroundSince == null) backgroundSince = now()
    }

    /** Back in the foreground. Returns true when the wallet should lock now. */
    @Synchronized fun enterForeground(): Boolean {
        val expired = isExpired()
        backgroundSince = null
        lastActivity = now()
        return expired
    }

    @Synchronized fun isExpired(): Boolean {
        val since = backgroundSince ?: lastActivity
        return now() - since >= timeoutMs
    }
}
