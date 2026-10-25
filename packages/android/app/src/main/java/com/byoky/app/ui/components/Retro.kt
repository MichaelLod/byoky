package com.byoky.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SheetState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PointMode
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.DialogProperties
import com.byoky.app.ui.theme.*
import kotlinx.coroutines.delay

// Building blocks of the retro-security design (docs/brand/README.md):
// square edges, 1px seam borders, Chakra Petch for headings and buttons,
// IBM Plex Mono for anything machine-like.

/**
 * Text shown in uppercase display type. Screen readers and UI tests still get
 * the sentence-case [text], so "UNLOCK" is read as a word, not spelled out.
 */
@Composable
fun CapsText(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = LocalTextStyle.current,
    color: Color = Color.Unspecified,
    textAlign: TextAlign? = null,
    maxLines: Int = Int.MAX_VALUE,
) {
    Text(
        text.uppercase(),
        modifier = modifier.semantics { contentDescription = text },
        style = style,
        color = color,
        textAlign = textAlign,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}

/** Violet fill, white Chakra Petch label. The one main action on a screen. */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    busy: Boolean = false,
    icon: ImageVector? = null,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = 48.dp),
        shape = RectangleShape,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (pressed) VioletHover else Violet,
            contentColor = Color.White,
            disabledContainerColor = Violet.copy(alpha = 0.35f),
            disabledContentColor = Color.White.copy(alpha = 0.6f),
        ),
        contentPadding = ButtonPadding,
        interactionSource = interactionSource,
    ) {
        ButtonContent(text, busy, icon)
    }
}

/** Transparent with a seam-strong border: secondary actions such as Cancel. */
@Composable
fun GhostButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: ImageVector? = null,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = 48.dp),
        shape = RectangleShape,
        border = BorderStroke(1.dp, if (enabled) SeamStrong else Seam),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = Bone, disabledContentColor = Dim),
        contentPadding = ButtonPadding,
    ) {
        ButtonContent(text, busy = false, icon = icon)
    }
}

/** Alarm border and text: destructive actions. */
@Composable
fun DangerButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: ImageVector? = null,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = 48.dp),
        shape = RectangleShape,
        border = BorderStroke(1.dp, if (enabled) Alarm else Seam),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = Alarm, disabledContentColor = Dim),
        contentPadding = ButtonPadding,
    ) {
        ButtonContent(text, busy = false, icon = icon)
    }
}

private val ButtonPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp)

@Composable
private fun ButtonContent(text: String, busy: Boolean, icon: ImageVector?) {
    if (busy) {
        CircularProgressIndicator(
            color = LocalContentColor.current,
            strokeWidth = 2.dp,
            strokeCap = StrokeCap.Butt,
            modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.width(10.dp))
    } else if (icon != null) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
    }
    CapsText(text, style = ButtonStyle, maxLines = 1)
}

/** Uppercase text action for dialogs: phosphor by default, alarm for destructive ones. */
@Composable
fun DialogButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    color: Color = Phosphor,
    enabled: Boolean = true,
) {
    TextButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = RectangleShape,
        colors = ButtonDefaults.textButtonColors(contentColor = color, disabledContentColor = Dim),
    ) {
        CapsText(text, style = ButtonStyle.copy(fontSize = 14.sp))
    }
}

/** Bracketed mono text action: `[ LOCK ]`. */
@Composable
fun BracketAction(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    color: Color = Phosphor,
    enabled: Boolean = true,
) {
    TextButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = RectangleShape,
        colors = ButtonDefaults.textButtonColors(contentColor = color, disabledContentColor = Dim),
    ) {
        Text(
            "[ ${text.uppercase()} ]",
            modifier = Modifier.semantics { contentDescription = text },
            style = MonoStyle.copy(letterSpacing = 0.1.em),
        )
    }
}

/** Mono, uppercase, wide-tracked label above a section or a field. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier, color: Color = Dim) {
    CapsText(text, modifier = modifier, style = MonoLabelStyle, color = color)
}

/**
 * Terminal status line with a prompt and a blinking cursor: `> WALLET LOCKED_`.
 * The cursor holds still when the system has animations turned off.
 */
@Composable
fun StatusLine(text: String, modifier: Modifier = Modifier, color: Color = Phosphor) {
    val reducedMotion = LocalReducedMotion.current
    var cursorOn by remember { mutableStateOf(true) }
    LaunchedEffect(reducedMotion) {
        cursorOn = true
        if (reducedMotion) return@LaunchedEffect
        while (true) {
            delay(530)
            cursorOn = !cursorOn
        }
    }
    val style = MonoLabelStyle.copy(fontSize = 12.sp, letterSpacing = 0.16.em)
    Row(modifier.clearAndSetSemantics { contentDescription = text }) {
        Text("> ${text.uppercase()}", style = style, color = color)
        Text("_", style = style, color = color, modifier = Modifier.graphicsLayer { alpha = if (cursorOn) 1f else 0f })
    }
}

/** A square status dot and mono text: `■ UNLOCKED · 3 KEYS`. */
@Composable
fun StatusPill(text: String, color: Color, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(7.dp).background(color))
        Spacer(Modifier.width(8.dp))
        CapsText(text, style = MonoLabelStyle.copy(letterSpacing = 0.12.em), color = color)
    }
}

/** Small mono tag on violet-soft, such as a provider name or `API KEY`. */
@Composable
fun Tag(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Lilac,
    background: Color = VioletSoft,
) {
    CapsText(
        text,
        modifier = modifier
            .background(background)
            .padding(horizontal = 6.dp, vertical = 2.dp),
        style = MonoLabelStyle.copy(fontSize = 10.sp, letterSpacing = 0.08.em),
        color = color,
        maxLines = 1,
    )
}

/** Card or row surface: crypt with a 1px seam border. */
fun Modifier.panel(background: Color = Crypt, border: Color = Seam): Modifier =
    this.background(background).border(1.dp, border)

/** 2px violet L-shapes at the corners. One featured panel per screen at most. */
fun Modifier.cornerBrackets(color: Color = Violet, length: Dp = 18.dp, thickness: Dp = 2.dp): Modifier =
    this.drawWithContent {
        drawContent()
        val l = length.toPx()
        val t = thickness.toPx()
        val w = size.width
        val h = size.height
        drawRect(color, Offset(0f, 0f), Size(l, t))
        drawRect(color, Offset(0f, 0f), Size(t, l))
        drawRect(color, Offset(w - l, 0f), Size(l, t))
        drawRect(color, Offset(w - t, 0f), Size(t, l))
        drawRect(color, Offset(0f, h - t), Size(l, t))
        drawRect(color, Offset(0f, h - l), Size(t, l))
        drawRect(color, Offset(w - l, h - t), Size(l, t))
        drawRect(color, Offset(w - t, h - l), Size(t, l))
    }

/** Faint phosphor dot grid for large backgrounds. */
fun Modifier.dotGrid(spacing: Dp = 24.dp, color: Color = Phosphor.copy(alpha = 0.08f)): Modifier =
    this.drawWithCache {
        val step = spacing.toPx()
        val dot = 1.dp.toPx()
        val width = size.width
        val height = size.height
        val points = buildList {
            var y = dot
            while (y < height) {
                var x = dot
                while (x < width) {
                    add(Offset(x, y))
                    x += step
                }
                y += step
            }
        }
        onDrawBehind {
            drawPoints(points, PointMode.Points, color, strokeWidth = dot, cap = StrokeCap.Square)
        }
    }

/** CRT scanlines drawn over the content. Drawing only: touches pass straight through. */
fun Modifier.scanlines(): Modifier =
    this.drawWithCache {
        val period = 3.dp.toPx()
        val line = 1.dp.toPx() / period
        val shade = Color.Black.copy(alpha = 0.2f)
        val brush = Brush.verticalGradient(
            0f to shade,
            line to shade,
            line to Color.Transparent,
            1f to Color.Transparent,
            startY = 0f,
            endY = period,
            tileMode = TileMode.Repeated,
        )
        onDrawWithContent {
            drawContent()
            drawRect(brush)
        }
    }

/** A 1px seam line under the element, as under a top bar. */
fun Modifier.bottomSeam(color: Color = Seam): Modifier =
    this.drawWithContent {
        drawContent()
        val t = 1.dp.toPx()
        drawRect(color, Offset(0f, size.height - t), Size(size.width, t))
    }

/**
 * Text input: void background and a 1px seam-strong border that turns violet
 * with a focus ring. The label sits above the field in mono capitals; tapping
 * it focuses the field. Secrets, keys and URLs pass [mono] for IBM Plex Mono.
 * [fieldModifier] goes on the field itself (an exposed dropdown's menuAnchor).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RetroTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String?,
    modifier: Modifier = Modifier,
    fieldModifier: Modifier = Modifier,
    placeholder: String? = null,
    mono: Boolean = false,
    enabled: Boolean = true,
    readOnly: Boolean = false,
    isError: Boolean = false,
    singleLine: Boolean = true,
    supportingText: String? = null,
    secret: Boolean = false,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val focused by interactionSource.collectIsFocusedAsState()
    val focusRequester = remember { FocusRequester() }
    val textStyle = if (mono) {
        MonoStyle.copy(fontSize = 15.sp, lineHeight = 20.sp)
    } else {
        MaterialTheme.typography.bodyLarge
    }
    val colors = OutlinedTextFieldDefaults.colors(
        focusedTextColor = Bone,
        unfocusedTextColor = Bone,
        disabledTextColor = Dim,
        errorTextColor = Bone,
        focusedContainerColor = Void,
        unfocusedContainerColor = Void,
        disabledContainerColor = Void,
        errorContainerColor = Void,
        cursorColor = Phosphor,
        errorCursorColor = Alarm,
        focusedBorderColor = Violet,
        unfocusedBorderColor = SeamStrong,
        disabledBorderColor = Seam,
        errorBorderColor = Alarm,
        focusedLeadingIconColor = Fog,
        unfocusedLeadingIconColor = Dim,
        focusedTrailingIconColor = Fog,
        unfocusedTrailingIconColor = Dim,
        errorTrailingIconColor = Alarm,
        focusedPlaceholderColor = Dim,
        unfocusedPlaceholderColor = Dim,
        disabledPlaceholderColor = Dim,
    )

    // One semantics node for label and field, as a floating-label field has.
    Column(modifier.semantics(mergeDescendants = true) {}) {
        if (label != null) {
            SectionLabel(
                label,
                color = if (isError) Alarm else Fog,
                modifier = Modifier.pointerInput(enabled) {
                    detectTapGestures { if (enabled) focusRequester.requestFocus() }
                },
            )
            Spacer(Modifier.height(6.dp))
        }
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = fieldModifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .focusRequester(focusRequester)
                .drawBehind {
                    if (focused && !isError) {
                        val ring = 3.dp.toPx()
                        drawRect(
                            FocusRing,
                            topLeft = Offset(-ring, -ring),
                            size = Size(size.width + 2 * ring, size.height + 2 * ring),
                        )
                    }
                },
            enabled = enabled,
            readOnly = readOnly,
            textStyle = textStyle.copy(color = if (enabled) Bone else Dim),
            // Secrets ask the keyboard for a password field: no suggestions,
            // no autocorrect, nothing learned. Otherwise the keyboard showed a
            // typed key in its suggestion strip and could keep it.
            keyboardOptions = if (secret) {
                keyboardOptions.copy(keyboardType = KeyboardType.Password, autoCorrectEnabled = false)
            } else {
                keyboardOptions
            },
            keyboardActions = keyboardActions,
            singleLine = singleLine,
            maxLines = if (singleLine) 1 else Int.MAX_VALUE,
            visualTransformation = visualTransformation,
            interactionSource = interactionSource,
            cursorBrush = SolidColor(if (isError) Alarm else Phosphor),
            decorationBox = { innerTextField ->
                OutlinedTextFieldDefaults.DecorationBox(
                    value = value,
                    innerTextField = innerTextField,
                    enabled = enabled,
                    singleLine = singleLine,
                    visualTransformation = visualTransformation,
                    interactionSource = interactionSource,
                    isError = isError,
                    placeholder = placeholder?.let { { Text(it, style = textStyle) } },
                    leadingIcon = leadingIcon,
                    trailingIcon = trailingIcon,
                    colors = colors,
                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp),
                    container = {
                        OutlinedTextFieldDefaults.Container(
                            enabled = enabled,
                            isError = isError,
                            interactionSource = interactionSource,
                            colors = colors,
                            shape = RectangleShape,
                            focusedBorderThickness = 1.dp,
                            unfocusedBorderThickness = 1.dp,
                        )
                    },
                )
            },
        )
        if (supportingText != null) {
            Spacer(Modifier.height(4.dp))
            Text(
                supportingText,
                color = if (isError) Alarm else Dim,
                fontSize = 11.sp,
                lineHeight = 15.sp,
            )
        }
    }
}

/**
 * AlertDialog in the retro style: crypt panel with a seam border, square
 * corners, an uppercase Chakra Petch title and fog body text.
 */
@Composable
fun RetroDialog(
    onDismissRequest: () -> Unit,
    title: String,
    confirmButton: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    dismissButton: (@Composable () -> Unit)? = null,
    titleColor: Color = Bone,
    icon: (@Composable () -> Unit)? = null,
    properties: DialogProperties = DialogProperties(),
    text: (@Composable () -> Unit)? = null,
) {
    AlertDialog(
        onDismissRequest = onDismissRequest,
        confirmButton = confirmButton,
        modifier = modifier.border(1.dp, Seam),
        dismissButton = dismissButton,
        icon = icon,
        title = { CapsText(title, color = titleColor) },
        text = text,
        shape = RectangleShape,
        containerColor = Crypt,
        iconContentColor = Phosphor,
        titleContentColor = titleColor,
        textContentColor = Fog,
        tonalElevation = 0.dp,
        properties = properties,
    )
}

/** Modal bottom sheet: a crypt panel with square corners and a seam edge. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RetroBottomSheet(
    onDismissRequest: () -> Unit,
    sheetState: SheetState = rememberModalBottomSheetState(),
    content: @Composable ColumnScope.() -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismissRequest,
        sheetState = sheetState,
        shape = RectangleShape,
        containerColor = Crypt,
        contentColor = Bone,
        tonalElevation = 0.dp,
        scrimColor = Color.Black.copy(alpha = 0.6f),
        dragHandle = {
            // The seam along the top edge rides with the handle, so it moves with the sheet.
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .drawBehind { drawRect(SeamStrong, size = Size(size.width, 1.dp.toPx())) },
                contentAlignment = Alignment.Center,
            ) {
                BottomSheetDefaults.DragHandle(shape = RectangleShape, color = SeamStrong)
            }
        },
        content = content,
    )
}

/** Dropdown menu on crypt with a seam border and no shadow. */
@Composable
fun RetroDropdownMenu(
    expanded: Boolean,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismissRequest,
        modifier = modifier,
        shape = RectangleShape,
        containerColor = Crypt,
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
        border = BorderStroke(1.dp, SeamStrong),
        content = content,
    )
}

/** Top app bar on void with an uppercase Chakra Petch title and a seam underline. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RetroTopBar(
    title: String,
    navigationIcon: @Composable () -> Unit = {},
    actions: @Composable RowScope.() -> Unit = {},
) {
    RetroTopBar(
        title = { CapsText(title, maxLines = 1) },
        navigationIcon = navigationIcon,
        actions = actions,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RetroTopBar(
    title: @Composable () -> Unit,
    navigationIcon: @Composable () -> Unit = {},
    actions: @Composable RowScope.() -> Unit = {},
) {
    TopAppBar(
        title = title,
        navigationIcon = navigationIcon,
        actions = actions,
        modifier = Modifier.bottomSeam(),
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = Void,
            scrolledContainerColor = Void,
            titleContentColor = Bone,
            navigationIconContentColor = Fog,
            actionIconContentColor = Fog,
        ),
    )
}
