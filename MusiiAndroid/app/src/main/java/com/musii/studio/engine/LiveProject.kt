package com.musii.studio.engine

import com.musii.studio.model.Clip
import com.musii.studio.model.Project

/**
 * Aktueller Projektstand für die Vorschau. Effekte der Vorschau lesen hieraus,
 * damit Farb-, Text- und Effektänderungen ohne Neuaufbau des Players sichtbar werden.
 */
object LiveProject {
    @Volatile
    var project: Project? = null
        set(value) {
            field = value
            clips = value?.let { p -> (p.main + p.overlays + p.audio).associateBy { it.id } } ?: emptyMap()
        }

    @Volatile
    private var clips: Map<String, Clip> = emptyMap()

    fun clip(id: String): Clip? = clips[id]
}
