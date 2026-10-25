package com.byoky.app.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import com.byoky.app.ui.theme.Ink
import com.byoky.app.ui.theme.LocalReducedMotion
import com.byoky.app.ui.theme.Lilac
import com.byoky.app.ui.theme.Phosphor
import com.byoky.app.ui.theme.PlexMono
import com.byoky.app.ui.theme.SeamStrong
import com.byoky.app.ui.theme.Violet
import com.byoky.app.ui.theme.VioletHover
import com.byoky.app.ui.theme.Void
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import kotlin.random.Random

/**
 * Muninn, the Byoky raven: docs/brand/raven.svg drawn natively, with the
 * states from docs/brand/README.md. Coordinates below are the SVG's own
 * (viewBox 240×240, facing right, perched on a violet key).
 */
enum class RavenMood {
    /** Head, eye and facing follow the finger; blinks every ~4s. */
    WATCHING,

    /** Wallet locked: head tucked, eye shut, "z z". */
    ASLEEP,

    /** A request is waiting: crest up, eye glowing, head tilted back. */
    ALERT,
}

/** Which part of the drawing to show. */
enum class RavenFrame(val left: Float, val top: Float, val extent: Float) {
    /** The whole bird on the violet key. */
    FULL(0f, 0f, 240f),

    /** Cropped to the bird on a plain perch bar, for headers and dialogs. */
    BUST(40f, 20f, 200f),
}

/**
 * Where the last touch on the screen was, in window coordinates. A screen
 * creates one with [rememberRavenGaze], reports touches with [watchedBy] and
 * hands it to its [Muninn].
 */
@Stable
class RavenGaze {
    internal var target by mutableStateOf<Offset?>(null)
    internal var area: LayoutCoordinates? = null
}

@Composable
fun rememberRavenGaze(): RavenGaze = remember { RavenGaze() }

/**
 * Reports touches anywhere in this element to [gaze]. It only observes: the
 * events are never consumed, so buttons, fields and scrolling work as usual.
 */
fun Modifier.watchedBy(gaze: RavenGaze): Modifier = this
    .onGloballyPositioned { gaze.area = it }
    .pointerInput(gaze) {
        awaitPointerEventScope {
            while (true) {
                val event = awaitPointerEvent(PointerEventPass.Initial)
                val change = event.changes.firstOrNull { it.pressed || it.type == PointerType.Mouse } ?: continue
                val area = gaze.area?.takeIf { it.isAttached } ?: continue
                gaze.target = area.localToWindow(change.position)
            }
        }
    }

/**
 * Draws the raven. Change [nodKey] to a new non-null value to make it nod
 * once (it also nods when first shown with a non-null key). With the
 * system's "Remove animations" setting on it holds a neutral pose: no
 * tracking, no blinking, no nod, and mood changes swap poses instantly.
 */
@Composable
fun Muninn(
    mood: RavenMood,
    modifier: Modifier = Modifier,
    frame: RavenFrame = RavenFrame.FULL,
    gaze: RavenGaze? = null,
    nodKey: Any? = null,
    contentDescription: String? = defaultDescription(mood),
) {
    val reducedMotion = LocalReducedMotion.current
    val density = LocalDensity.current
    val anchor = remember { RavenAnchor() }
    val textMeasurer = rememberTextMeasurer()

    val sleep = remember { Animatable(if (mood == RavenMood.ASLEEP) 1f else 0f) }
    val alert = remember { Animatable(if (mood == RavenMood.ALERT) 1f else 0f) }
    val tilt = remember { Animatable(0f) }
    val pupil = remember { Animatable(Offset.Zero, Offset.VectorConverter) }
    val nod = remember { Animatable(0f) }
    var facingLeft by remember { mutableStateOf(false) }
    var blinking by remember { mutableStateOf(false) }
    val facing by animateFloatAsState(
        targetValue = if (facingLeft) -1f else 1f,
        animationSpec = tween(durationMillis = 140),
        label = "raven facing",
    )

    // Pose changes between moods.
    LaunchedEffect(mood, reducedMotion) {
        val sleepTarget = if (mood == RavenMood.ASLEEP) 1f else 0f
        val alertTarget = if (mood == RavenMood.ALERT) 1f else 0f
        if (reducedMotion) {
            sleep.snapTo(sleepTarget)
            alert.snapTo(alertTarget)
        } else {
            launch { sleep.animateTo(sleepTarget, tween(durationMillis = 320, easing = FastOutSlowInEasing)) }
            launch { alert.animateTo(alertTarget, tween(durationMillis = 220)) }
        }
    }

    // WATCHING: follow the finger. Every other case returns to neutral.
    LaunchedEffect(mood, gaze, reducedMotion) {
        if (mood != RavenMood.WATCHING || gaze == null || reducedMotion) {
            facingLeft = false
            if (reducedMotion) {
                tilt.snapTo(0f)
                pupil.snapTo(Offset.Zero)
            } else {
                launch { tilt.animateTo(0f, TrackSpring) }
                launch { pupil.animateTo(Offset.Zero, PupilSpring) }
            }
            return@LaunchedEffect
        }
        snapshotFlow { gaze.target }.filterNotNull().collectLatest { target ->
            val coords = anchor.coords?.takeIf { it.isAttached } ?: return@collectLatest
            val unit = coords.size.width / frame.extent
            val head = coords.localToWindow(
                Offset((HEAD_X - frame.left) * unit, (HEAD_Y - frame.top) * unit)
            )
            // Distances in dp, the "px" of the web mockups.
            val dx = (target.x - head.x) / density.density
            val dy = (target.y - head.y) / density.density
            val left = dx < -20f
            facingLeft = left
            val ahead = if (left) -dx else dx
            coroutineScope {
                launch { tilt.animateTo((dy * 0.06f).coerceIn(-16f, 16f), TrackSpring) }
                launch {
                    pupil.animateTo(
                        Offset((ahead / 40f).coerceIn(-1f, 2.6f), (dy / 40f).coerceIn(-2.4f, 2.4f)),
                        PupilSpring,
                    )
                }
            }
        }
    }

    // Blink every ~4s while watching.
    LaunchedEffect(mood, reducedMotion) {
        blinking = false
        if (mood != RavenMood.WATCHING || reducedMotion) return@LaunchedEffect
        while (true) {
            delay(Random.nextLong(3400, 4600))
            blinking = true
            delay(140)
            blinking = false
        }
    }

    // NOD: one quick dip of 18° and back, ~260ms in all.
    LaunchedEffect(nodKey) {
        if (nodKey == null || reducedMotion) return@LaunchedEffect
        nod.animateTo(18f, tween(durationMillis = 130, easing = FastOutSlowInEasing))
        nod.animateTo(0f, tween(durationMillis = 130, easing = FastOutSlowInEasing))
    }

    val semantics = if (contentDescription != null) {
        Modifier.semantics {
            this.contentDescription = contentDescription
            role = Role.Image
        }
    } else {
        Modifier
    }

    Canvas(
        modifier
            .onGloballyPositioned { anchor.coords = it }
            .then(semantics)
    ) {
        val unit = size.minDimension / frame.extent
        val s = sleep.value
        val a = alert.value
        withTransform({
            translate((size.width - frame.extent * unit) / 2f, (size.height - frame.extent * unit) / 2f)
            scale(unit, unit, pivot = Offset.Zero)
            translate(-frame.left, -frame.top)
            scale(facing, 1f, pivot = Offset(frame.left + frame.extent / 2f, 0f))
        }) {
            drawPerch(frame)
            drawBody(frame, highlightAlpha = 0.6f - 0.15f * s)

            val awakeTilt = tilt.value + nod.value - 8f * a
            withTransform({
                translate(-6f * s, 26f * s)
                rotate(awakeTilt * (1f - s) + 34f * s, pivot = Offset(HEAD_X_PIVOT, HEAD_Y_PIVOT))
            }) {
                drawHead(
                    sleep = s,
                    alert = a,
                    blinking = blinking,
                    pupil = pupil.value * (1f - a) + Offset(2.6f, 0f) * a,
                )
            }
        }

        // "z z" beside the tucked head.
        val zAlpha = ((s - 0.5f) * 2f).coerceIn(0f, 1f)
        if (zAlpha > 0f) {
            val left = (198f - frame.left) * unit + (size.width - frame.extent * unit) / 2f
            val top = (34f - frame.top) * unit + (size.height - frame.extent * unit) / 2f
            val big = TextStyle(fontFamily = PlexMono, color = Phosphor.copy(alpha = zAlpha), fontSize = (20f * unit).toSp())
            val small = big.copy(fontSize = (14f * unit).toSp())
            val first = textMeasurer.measure("z", big)
            drawText(first, topLeft = Offset(left, top))
            drawText(
                textMeasurer.measure("z", small),
                topLeft = Offset(left + first.size.width + 3f * unit, top + 7f * unit),
            )
        }
    }
}

private fun defaultDescription(mood: RavenMood): String = when (mood) {
    RavenMood.WATCHING -> "Muninn the raven, watching"
    RavenMood.ASLEEP -> "Muninn the raven, asleep"
    RavenMood.ALERT -> "Muninn the raven, on alert"
}

private class RavenAnchor {
    var coords: LayoutCoordinates? = null
}

private val TrackSpring = spring<Float>(stiffness = Spring.StiffnessMediumLow)
private val PupilSpring = spring<Offset>(stiffness = Spring.StiffnessMediumLow)

// Reference point for tracking (the middle of the head) and the head's pivot.
private const val HEAD_X = 150f
private const val HEAD_Y = 68f
private const val HEAD_X_PIVOT = 140f
private const val HEAD_Y_PIVOT = 96f

// Shading of the canonical drawing.
private val TailDark = Color(0xFF0E0B14)
private val TailLight = Color(0xFF1D1629)
private val Flank = Color(0xFF17121F)
private val Wing = Color(0xFF1A1424)
private val WingTop = Color(0xFF271D38)
private val WingBar = Color(0xFF2F2444)
private val Crown = Color(0xFF231A33)
private val Cheek = Color(0xFF17121F)
private val BeakLower = Color(0xFF1F1830)
private val CrestFront = Color(0xFF4C3A6E)

private object RavenPaths {
    val tail = polygon(84f, 170f, 112f, 178f, 80f, 214f, 44f, 222f, 58f, 194f)
    val tailCropped = polygon(84f, 170f, 112f, 178f, 80f, 214f, 58f, 194f)
    val tailHighlight = polygon(84f, 170f, 96f, 176f, 58f, 214f, 44f, 222f)
    val body = polygon(108f, 96f, 130f, 90f, 152f, 98f, 166f, 122f, 162f, 152f, 142f, 174f, 112f, 182f, 84f, 172f, 70f, 150f, 84f, 118f)
    val flank = polygon(152f, 98f, 166f, 122f, 162f, 152f, 146f, 128f)
    val wing = polygon(104f, 106f, 146f, 120f, 144f, 150f, 118f, 176f, 86f, 170f, 78f, 142f)
    val wingTop = polygon(104f, 106f, 146f, 120f, 120f, 132f, 84f, 128f)
    val wingBar1 = polygon(86f, 150f, 132f, 138f, 134f, 142f, 90f, 156f)
    val wingBar2 = polygon(92f, 164f, 128f, 154f, 129f, 158f, 96f, 169f)
    val backHighlight = polygon(84f, 118f, 108f, 96f, 113f, 100f, 89f, 123f)
    val crestBack = polygon(128f, 48f, 120f, 26f, 138f, 42f)
    val crestFront = polygon(138f, 42f, 136f, 20f, 150f, 38f)
    val head = polygon(126f, 50f, 148f, 38f, 170f, 44f, 180f, 62f, 176f, 86f, 152f, 98f, 130f, 90f, 120f, 70f)
    val crown = polygon(148f, 38f, 170f, 44f, 160f, 58f)
    val cheek = polygon(120f, 70f, 126f, 50f, 138f, 62f)
    val beakLower = polygon(174f, 56f, 222f, 74f, 176f, 84f)
    val beakUpper = polygon(174f, 56f, 222f, 74f, 178f, 70f)
    val browHighlight = polygon(126f, 50f, 148f, 38f, 149f, 42f, 129f, 54f)

    private fun polygon(vararg xy: Float) = Path().apply {
        moveTo(xy[0], xy[1])
        var i = 2
        while (i < xy.size) {
            lineTo(xy[i], xy[i + 1])
            i += 2
        }
        close()
    }
}

private fun DrawScope.drawPerch(frame: RavenFrame) {
    if (frame == RavenFrame.BUST) {
        drawRect(Violet, Offset(60f, 196.5f), Size(160f, 6f))
        return
    }
    // The key: bow, shaft and two bits.
    drawCircle(Violet, radius = 14f, center = Offset(52f, 200f), style = Stroke(width = 7f))
    drawRect(Violet, Offset(65f, 196.5f), Size(135f, 7f))
    drawRect(Violet, Offset(172f, 203f), Size(7f, 13f))
    drawRect(Violet, Offset(186f, 203f), Size(7f, 8f))
}

private fun DrawScope.drawBody(frame: RavenFrame, highlightAlpha: Float) {
    if (frame == RavenFrame.BUST) {
        drawPath(RavenPaths.tailCropped, TailDark)
    } else {
        drawPath(RavenPaths.tail, TailDark)
        drawPath(RavenPaths.tailHighlight, TailLight)
    }
    drawRect(SeamStrong, Offset(117f, 176f), Size(4f, 21f))
    drawRect(SeamStrong, Offset(133f, 174f), Size(4f, 23f))
    drawPath(RavenPaths.body, Ink)
    drawPath(RavenPaths.flank, Flank)
    drawPath(RavenPaths.wing, Wing)
    drawPath(RavenPaths.wingTop, WingTop)
    drawPath(RavenPaths.wingBar1, WingBar)
    drawPath(RavenPaths.wingBar2, WingBar)
    drawPath(RavenPaths.backHighlight, VioletHover, alpha = highlightAlpha)
}

private fun DrawScope.drawHead(sleep: Float, alert: Float, blinking: Boolean, pupil: Offset) {
    if (alert > 0f) {
        drawPath(RavenPaths.crestBack, SeamStrong, alpha = alert)
        drawPath(RavenPaths.crestFront, CrestFront, alpha = alert)
    }
    drawPath(RavenPaths.head, Ink)
    drawPath(RavenPaths.crown, Crown)
    drawPath(RavenPaths.cheek, Cheek)
    drawPath(RavenPaths.beakLower, BeakLower)
    drawPath(RavenPaths.beakUpper, SeamStrong)
    drawPath(RavenPaths.browHighlight, Phosphor, alpha = 0.75f)
    if (alert > 0f) {
        drawCircle(Violet, radius = 11f, center = Offset(160f, 62f), alpha = 0.35f * alert)
    }
    if (sleep >= 0.5f) {
        drawRect(Phosphor, Offset(153f, 61f), Size(14f, 2.4f))
        return
    }
    val eyeRadius = 7f + 0.5f * alert
    val eyeHeight = if (blinking) 0.8f else eyeRadius
    drawOval(
        Lilac,
        topLeft = Offset(160f - eyeRadius, 62f - eyeHeight),
        size = Size(eyeRadius * 2f, eyeHeight * 2f),
    )
    if (!blinking) {
        drawCircle(Void, radius = 3.4f, center = Offset(161f, 62f) + pupil)
    }
}
