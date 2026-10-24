package com.byoky.app.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * A notice shown on one launch only. Something earlier (the launch cleanup)
 * leaves a persisted "pending" flag; [load] turns it into [visible]. The
 * first time the notice is actually on screen, [markShown] clears the flag,
 * so no later launch shows it again, while it stays visible for the rest of
 * this session until [dismiss].
 *
 * Pure Kotlin, unit-tested on the JVM.
 */
class OneTimeNotice(
    private val isPending: () -> Boolean,
    private val clearPending: () -> Unit,
) {
    private val _visible = MutableStateFlow(false)
    val visible: StateFlow<Boolean> = _visible.asStateFlow()

    /** Show the notice this session if it is still pending. */
    fun load() {
        _visible.value = isPending()
    }

    /** The notice is on screen: it won't come back on a later launch. */
    fun markShown() {
        if (_visible.value) clearPending()
    }

    /** Hide the notice now and for good. */
    fun dismiss() {
        _visible.value = false
        clearPending()
    }
}
