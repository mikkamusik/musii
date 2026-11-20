package com.musii.studio.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.musii.studio.engine.Paths
import com.musii.studio.engine.Thumbnails
import com.musii.studio.model.AspectPreset
import com.musii.studio.model.Project
import com.musii.studio.model.newId
import kotlinx.serialization.json.Json
import java.io.File
import java.io.FileOutputStream

data class ProjectSummary(
    val id: String,
    val name: String,
    val modified: Long,
    val durationUs: Long,
    val aspect: AspectPreset,
    val thumb: File?,
)

class ProjectStore(private val ctx: Context) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; prettyPrint = false }

    private fun dir(id: String) = File(Paths.projectsDir(ctx), id).apply { mkdirs() }
    private fun file(id: String) = File(dir(id), "projekt.json")
    private fun thumbFile(id: String) = File(dir(id), "vorschau.jpg")

    fun list(): List<ProjectSummary> =
        (Paths.projectsDir(ctx).listFiles() ?: emptyArray())
            .mapNotNull { d -> load(d.name)?.let { p -> ProjectSummary(p.id, p.name, p.modified, p.durationUs, p.aspect, thumbFile(p.id).takeIf { it.exists() }) } }
            .sortedByDescending { it.modified }

    fun load(id: String): Project? = try {
        json.decodeFromString(Project.serializer(), file(id).readText())
    } catch (_: Exception) {
        null
    }

    fun save(p: Project) {
        val updated = p.copy(modified = System.currentTimeMillis())
        val tmp = File(dir(p.id), "projekt.json.tmp")
        tmp.writeText(json.encodeToString(Project.serializer(), updated))
        tmp.renameTo(file(p.id))
        makeThumb(p)
    }

    private val thumbKeys = HashMap<String, String>()

    private fun makeThumb(p: Project) {
        val first = p.main.firstOrNull() ?: return
        val m = p.media(first.mediaId) ?: return
        val key = m.id + ":" + first.sourceStartUs
        if (thumbKeys[p.id] == key && thumbFile(p.id).exists()) return
        thumbKeys[p.id] = key
        val bmp: Bitmap? = try {
            Thumbnails.strip(ctx, m).firstOrNull()
        } catch (_: Exception) { null }
        bmp?.let { b -> FileOutputStream(thumbFile(p.id)).use { b.compress(Bitmap.CompressFormat.JPEG, 85, it) } }
    }

    fun create(name: String, aspect: AspectPreset): Project {
        val p = Project(name = name, aspect = aspect)
        save(p)
        return p
    }

    fun delete(id: String) {
        dir(id).deleteRecursively()
    }

    fun rename(id: String, name: String) {
        load(id)?.let { save(it.copy(name = name)) }
    }

    fun duplicate(id: String) {
        load(id)?.let { save(it.copy(id = newId(), name = it.name + " Kopie", created = System.currentTimeMillis())) }
    }

    fun thumbBitmap(f: File?): Bitmap? = f?.let { BitmapFactory.decodeFile(it.absolutePath) }
}
