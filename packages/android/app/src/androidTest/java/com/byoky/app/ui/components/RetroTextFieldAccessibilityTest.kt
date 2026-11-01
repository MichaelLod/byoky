package com.byoky.app.ui.components

import android.view.accessibility.AccessibilityNodeInfo
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isFocused
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * What screen readers get from RetroTextField. An editable field keeps its
 * typed text as its text and merges its caption, and so does a read-only
 * one. A picker is the anchor of an exposed dropdown, as the group editor's
 * Provider and Credential pickers are: a drop-down list whose description
 * holds its caption and its value (its placeholder when empty, never a
 * secret), before and after the menu has been used.
 */
@RunWith(AndroidJUnit4::class)
class RetroTextFieldAccessibilityTest {
    @get:Rule
    val compose = createComposeRule()

    private val pickerMatcher = SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.DropdownList)

    @OptIn(ExperimentalMaterial3Api::class)
    private fun showFields() {
        compose.setContent {
            Column {
                RetroTextField(value = "Work key", onValueChange = {}, label = "Label")
                // As the group editor builds its pickers (AppsScreen.kt).
                var expanded by remember { mutableStateOf(false) }
                var provider by remember { mutableStateOf("Anthropic") }
                ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = !expanded }) {
                    RetroTextField(
                        value = provider,
                        onValueChange = {},
                        picker = true,
                        label = "Provider",
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                        fieldModifier = Modifier.menuAnchor(),
                    )
                    ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                        listOf("Anthropic", "OpenAI").forEach { name ->
                            DropdownMenuItem(
                                text = { Text(name) },
                                onClick = {
                                    provider = name
                                    expanded = false
                                },
                            )
                        }
                    }
                }
            }
        }
    }

    @Test
    fun pickerIsOneDropDownListWithCaptionAndValue() {
        showFields()
        compose.onNode(pickerMatcher)
            .assert(hasContentDescription("Provider, Anthropic"))
            .assert(hasText("Anthropic"))
            .assertHasClickAction()
        // The caption is not a stop of its own.
        compose.onAllNodesWithContentDescription("Provider").assertCountEquals(0)
    }

    @Test
    fun editableFieldKeepsItsTextAndMergesItsCaption() {
        showFields()
        compose.onNode(hasSetTextAction(), useUnmergedTree = true)
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("Work key")))
            // A description on an editable field can be read instead of its text.
            .assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.ContentDescription))
        compose.onNode(hasSetTextAction()).assert(hasContentDescription("Label"))
    }

    @Test
    fun accessibilityTreeHasASpinnerAndAnEditText() {
        showFields()
        val nodes = accessibilityNodes(until = "Anthropic")

        // Compose names the class from the role only for a node without
        // children. TalkBack reads a Spinner's description (it skips the
        // text when there is one) and says "drop-down list".
        val picker = nodes.single { it.text?.toString() == "Anthropic" }
        assertEquals("android.widget.Spinner", picker.className?.toString())
        assertEquals("Provider, Anthropic", picker.contentDescription?.toString())
        assertTrue(picker.isClickable)
        assertTrue(picker.isFocusable)
        assertTrue(nodes.none { it.contentDescription?.toString() == "Provider" })

        val field = nodes.single { it.text?.toString() == "Work key" }
        assertEquals("android.widget.EditText", field.className?.toString())
        assertNull(field.contentDescription)
        val captions = (0 until field.childCount).mapNotNull { field.getChild(it)?.contentDescription?.toString() }
        assertTrue("caption missing from $captions", "Label" in captions)
    }

    @Test
    fun pickerStaysASpinnerOnceTheMenuHasBeenUsed() {
        showFields()
        compose.onNode(pickerMatcher).performClick()
        compose.onNodeWithText("OpenAI").performClick()
        // Opening the menu focuses the anchor, and a focused text field
        // gains a child node (the magnifier's).
        compose.onNode(pickerMatcher).assert(isFocused())

        val picker = accessibilityNodes(until = "OpenAI").single { it.text?.toString() == "OpenAI" }
        assertEquals("android.widget.Spinner", picker.className?.toString())
        assertEquals("Provider, OpenAI", picker.contentDescription?.toString())
        assertTrue(picker.isFocused)
    }

    @Test
    fun readOnlyFieldThatIsNotAPickerStaysATextField() {
        compose.setContent {
            RetroTextField(value = "https://api.example.com", onValueChange = {}, label = "Endpoint", readOnly = true)
        }
        compose.onAllNodes(pickerMatcher).assertCountEquals(0)
        val field = SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("https://api.example.com"))
        compose.onNode(field, useUnmergedTree = true)
            .assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.ContentDescription))
        compose.onNode(field).assert(hasContentDescription("Endpoint"))
    }

    @OptIn(ExperimentalMaterial3Api::class)
    @Test
    fun secretPickerNeverExposesItsValue() {
        compose.setContent {
            ExposedDropdownMenuBox(expanded = false, onExpandedChange = {}) {
                RetroTextField(
                    value = SECRET,
                    onValueChange = {},
                    picker = true,
                    secret = true,
                    visualTransformation = PasswordVisualTransformation(),
                    label = "Key",
                    fieldModifier = Modifier.menuAnchor(),
                )
            }
        }
        compose.onNode(pickerMatcher).assert(hasContentDescription("Key"))
        for (unmerged in listOf(false, true)) {
            compose.onAllNodes(hasText(SECRET, substring = true), useUnmergedTree = unmerged).assertCountEquals(0)
            compose.onAllNodes(hasContentDescription(SECRET, substring = true), useUnmergedTree = unmerged)
                .assertCountEquals(0)
        }
        val nodes = accessibilityNodes(until = "Key", byDescription = true)
        assertTrue(nodes.none { SECRET in it.text?.toString().orEmpty() || SECRET in it.contentDescription?.toString().orEmpty() })
    }

    @OptIn(ExperimentalMaterial3Api::class)
    @Test
    fun emptyPickerReadsItsPlaceholder() {
        compose.setContent {
            ExposedDropdownMenuBox(expanded = false, onExpandedChange = {}) {
                RetroTextField(
                    value = "",
                    onValueChange = {},
                    picker = true,
                    label = "Provider",
                    placeholder = "Choose a provider",
                    fieldModifier = Modifier.menuAnchor(),
                )
            }
        }
        compose.onNode(pickerMatcher).assert(hasContentDescription("Provider, Choose a provider"))
    }

    /** The app window's accessibility nodes, as TalkBack and uiautomator see them. */
    private fun accessibilityNodes(until: String, byDescription: Boolean = false): List<AccessibilityNodeInfo> {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val automation = instrumentation.uiAutomation
        val packageName = instrumentation.targetContext.packageName
        repeat(50) {
            compose.waitForIdle()
            val root = automation.rootInActiveWindow
            if (root != null && root.packageName?.toString() == packageName) {
                val nodes = mutableListOf<AccessibilityNodeInfo>()
                fun walk(node: AccessibilityNodeInfo) {
                    nodes += node
                    for (i in 0 until node.childCount) node.getChild(i)?.let(::walk)
                }
                walk(root)
                val found = if (byDescription) {
                    nodes.any { it.contentDescription?.toString() == until }
                } else {
                    nodes.any { it.text?.toString() == until }
                }
                if (found) return nodes
            }
            Thread.sleep(100)
        }
        throw AssertionError("\"$until\" never showed up in the accessibility tree")
    }

    private companion object {
        const val SECRET = "sk-ant-api03-not-a-real-key"
    }
}
