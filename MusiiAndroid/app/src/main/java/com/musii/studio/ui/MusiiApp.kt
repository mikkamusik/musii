package com.musii.studio.ui

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musii.studio.data.ProjectStore
import com.musii.studio.data.ProjectSummary
import com.musii.studio.editor.EditorState
import com.musii.studio.model.AspectPreset
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun MusiiApp(startProject: String?) {
    val ctx = LocalContext.current
    val store = remember { ProjectStore(ctx.applicationContext) }
    var openId by remember { mutableStateOf(startProject) }
    var pendingImport by remember { mutableStateOf<List<Uri>>(emptyList()) }
    MusiiTheme {
        Surface(Modifier.fillMaxSize(), color = C.bg) {
            val id = openId
            if (id == null) {
                HomeScreen(store,
                    onOpen = { openId = it },
                    onCreate = { aspect, uris ->
                        val df = SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.GERMANY)
                        val p = store.create("Projekt " + df.format(Date()), aspect)
                        pendingImport = uris
                        openId = p.id
                    })
            } else {
                val project = remember(id) { store.load(id) }
                if (project == null) {
                    LaunchedEffect(id) { openId = null }
                } else {
                    val editor = remember(id) { EditorState(ctx.applicationContext, project, store) }
                    DisposableEffect(id) { onDispose { editor.release() } }
                    LaunchedEffect(id) {
                        if (pendingImport.isNotEmpty()) {
                            editor.importUris(pendingImport, EditorState.Target.AUTO)
                            pendingImport = emptyList()
                        }
                    }
                    BackHandler { openId = null }
                    EditorScreen(editor, onClose = { openId = null })
                }
            }
        }
    }
}

@Composable
fun HomeScreen(store: ProjectStore, onOpen: (String) -> Unit, onCreate: (AspectPreset, List<Uri>) -> Unit) {
    var projects by remember { mutableStateOf(store.list()) }
    var menuFor by remember { mutableStateOf<ProjectSummary?>(null) }
    var renameFor by remember { mutableStateOf<ProjectSummary?>(null) }
    var deleteFor by remember { mutableStateOf<ProjectSummary?>(null) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(50)) { uris ->
        if (uris.isNotEmpty()) onCreate(AspectPreset.R9x16, uris)
    }
    LaunchedEffect(Unit) { projects = store.list() }

    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
            AppLogo(40.dp)
            Spacer(Modifier.width(12.dp))
            Column {
                Text("Musii Studio", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Text("Videoschnitt – alles frei, ohne Wasserzeichen", fontSize = 12.sp, color = C.text2)
            }
        }
        Text("Neues Projekt", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 20.dp))
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                Column(
                    Modifier.size(width = 130.dp, height = 120.dp).clip(RoundedCornerShape(14.dp)).background(C.panel2)
                        .border(1.dp, C.accent.copy(alpha = 0.6f), RoundedCornerShape(14.dp))
                        .clickable { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) },
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                ) {
                    Box(Modifier.size(46.dp).clip(RoundedCornerShape(50)).background(C.accent), contentAlignment = Alignment.Center) {
                        Icon(Icons.Default.Add, null, tint = Color.Black)
                    }
                    Spacer(Modifier.height(8.dp))
                    Text("Medien wählen", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            items(AspectPreset.entries) { a ->
                Column(
                    Modifier.size(width = 100.dp, height = 120.dp).clip(RoundedCornerShape(14.dp)).background(C.panel2)
                        .clickable { onCreate(a, emptyList()) },
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                ) {
                    val r = a.w.toFloat() / a.h
                    Box(Modifier.size(if (r >= 1) 46.dp else (46 * r).dp, if (r >= 1) (46 / r).dp else 46.dp).border(2.dp, Color.White.copy(alpha = 0.85f), RoundedCornerShape(4.dp)))
                    Spacer(Modifier.height(8.dp))
                    Text(a.title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    Text(a.subtitle, fontSize = 9.sp, color = C.text2, maxLines = 1)
                }
            }
        }
        Text("Meine Projekte (${projects.size})", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
        if (projects.isEmpty()) {
            Text("Noch keine Projekte. Tippe oben auf „Medien wählen“.", color = C.text2, fontSize = 13.sp, modifier = Modifier.padding(20.dp))
        }
        LazyVerticalGrid(GridCells.Adaptive(160.dp), contentPadding = PaddingValues(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(projects, key = { it.id }) { s ->
                val thumb = remember(s.thumb, s.modified) { store.thumbBitmap(s.thumb)?.asImageBitmap() }
                Column(Modifier.clip(RoundedCornerShape(12.dp)).clickable { onOpen(s.id) }) {
                    Box(Modifier.fillMaxWidth().height(110.dp).clip(RoundedCornerShape(12.dp)).background(C.panel3)) {
                        if (thumb != null) Image(thumb, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                        Text(formatTime(s.durationUs), fontSize = 10.sp, modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp).background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(4.dp)).padding(horizontal = 4.dp, vertical = 1.dp))
                        Box(Modifier.align(Alignment.TopEnd)) {
                            IconButton(onClick = { menuFor = s }) { Icon(Icons.Default.MoreVert, null) }
                            DropdownMenu(expanded = menuFor?.id == s.id, onDismissRequest = { menuFor = null }) {
                                DropdownMenuItem(text = { Text("Öffnen") }, onClick = { menuFor = null; onOpen(s.id) })
                                DropdownMenuItem(text = { Text("Umbenennen") }, onClick = { menuFor = null; renameFor = s })
                                DropdownMenuItem(text = { Text("Duplizieren") }, onClick = { menuFor = null; store.duplicate(s.id); projects = store.list() })
                                DropdownMenuItem(text = { Text("Löschen") }, onClick = { menuFor = null; deleteFor = s })
                            }
                        }
                    }
                    Text(s.name, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1, modifier = Modifier.padding(top = 6.dp))
                    Text(s.aspect.title + " · " + SimpleDateFormat("dd.MM.yy HH:mm", Locale.GERMANY).format(Date(s.modified)), fontSize = 10.sp, color = C.text2)
                }
            }
        }
    }

    renameFor?.let { s ->
        var name by remember(s.id) { mutableStateOf(s.name) }
        AlertDialog(onDismissRequest = { renameFor = null },
            title = { Text("Umbenennen") },
            text = { OutlinedTextField(name, { name = it }, singleLine = true) },
            confirmButton = { TextButton({ store.rename(s.id, name); renameFor = null; projects = store.list() }) { Text("OK") } },
            dismissButton = { TextButton({ renameFor = null }) { Text("Abbrechen") } })
    }
    deleteFor?.let { s ->
        AlertDialog(onDismissRequest = { deleteFor = null },
            title = { Text("„${s.name}“ löschen?") },
            text = { Text("Das Projekt wird endgültig gelöscht.") },
            confirmButton = { TextButton({ store.delete(s.id); deleteFor = null; projects = store.list() }) { Text("Löschen", color = C.accent2) } },
            dismissButton = { TextButton({ deleteFor = null }) { Text("Abbrechen") } })
    }
}
