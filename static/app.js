const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const COLORS = ["#6c3bff", "#35a7ff", "#48f0e5", "#a98bff", "#ffb86b", "#ff6b81"];
const KIND_NAMES = {
  like: "Reinforced",
  dislike: "Rejected",
  keep: "Kept for song",
  request: "Change request",
  setup: "Calibrated",
  restore: "Restored",
};
const TAB_NAMES = { studio: "Studio", preferences: "Preferences", engine: "Learning engine", split: "Split sheet" };
const HOOKS = ["Chorus", "Drop"];

let state = null;
let suggestion = null;
let rulesView = "since_setup";
let seenVersion = 0;
let freshVersion = null;
const choice = { genre: null, mood: null, bpm: 90 };
const people = [];
const synced = new Set();
const audio = { ctx: null, nodes: [], timers: [] };

const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const band = (bpm) => (bpm < 90 ? "slow" : bpm < 115 ? "medium" : "fast");

async function api(path, body) {
  const options = body === undefined
    ? {}
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

function toast(message, isError = false) {
  const box = $("#toast");
  box.textContent = message;
  box.classList.toggle("error", isError);
  box.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (box.hidden = true), 5200);
}

function showTab(name) {
  $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === name));
  $("#tab-name").textContent = TAB_NAMES[name];
  if (name === "engine" && state?.ready) {
    seenVersion = state.version;
    renderBadge();
  }
  window.scrollTo({ top: 0 });
}

function stopAudio() {
  audio.nodes.forEach((n) => { try { n.stop(); } catch (e) {} });
  audio.timers.forEach(clearTimeout);
  audio.nodes = [];
  audio.timers = [];
  $$(".chord").forEach((c) => c.classList.remove("on"));
}

function tone(freq, start, length, type, level) {
  const osc = audio.ctx.createOscillator();
  const gain = audio.ctx.createGain();
  const filter = audio.ctx.createBiquadFilter();
  osc.type = type;
  osc.frequency.value = freq;
  filter.type = "lowpass";
  filter.frequency.value = 1800;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(level, start + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length * 0.95);
  osc.connect(filter).connect(gain).connect(audio.ctx.destination);
  osc.start(start);
  osc.stop(start + length);
  audio.nodes.push(osc);
}

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

function strum(rhythm, midi, start, beat) {
  const level = 0.12 / midi.length + 0.02;
  if (rhythm === "arpeggio") {
    for (let i = 0; i < 8; i++) tone(hz(midi[i % midi.length] + 12), start + i * beat * 0.5, beat * 0.5, "triangle", 0.09);
    return;
  }
  const hits = rhythm === "syncopated" ? [[0, 1.5], [1.5, 1], [2.5, 0.5], [3, 1]] : [[0, 4]];
  hits.forEach(([at, length]) => midi.forEach((m) => tone(hz(m + 12), start + at * beat, length * beat, "triangle", level)));
}

function play() {
  if (!suggestion) return;
  stopAudio();
  audio.ctx = audio.ctx || new AudioContext();
  const idea = suggestion.idea;
  const beat = 60 / idea.bpm;
  const cards = $$(".chord");
  let time = audio.ctx.currentTime + 0.05;
  idea.chords.forEach((chord, i) => {
    strum(idea.features.rhythm, chord.midi, time, beat);
    tone(hz(chord.midi[0] - 12), time, beat * 4, "sine", 0.18);
    const delay = (time - audio.ctx.currentTime) * 1000;
    audio.timers.push(setTimeout(() => cards[i]?.classList.add("on"), delay));
    audio.timers.push(setTimeout(() => cards[i]?.classList.remove("on"), delay + beat * 4000));
    time += beat * 4;
  });
}

function renderHeader() {
  const label = state?.ready
    ? `Session: ${state.options.genres[state.profile.genre]} · ${state.options.moods[state.profile.mood]}`
    : "Not calibrated";
  $("#session-label").textContent = label;
  if (state?.ready && !$("#who").value) $("#who").value = state.profile.name;
}

function renderSuggestion() {
  const ready = Boolean(state?.ready && suggestion);
  $("#onboarding").hidden = ready;
  $("#studio-body").hidden = !ready;
  $("#play").disabled = !ready;
  if (!ready) return;
  const { idea, reasons } = suggestion;
  const [root, mode] = idea.key.split(" ");
  $("#bpm-readout").textContent = idea.bpm;
  $("#key-readout").textContent = `${root} ${mode === "minor" ? "MIN" : "MAJ"}`;
  $("#tile-key").textContent = idea.key;
  $("#tile-tempo").textContent = `${idea.bpm} BPM`;
  $("#tile-genre").textContent = state.options.genres[state.profile.genre];
  $("#tile-mood").textContent = state.options.moods[idea.features.mood];
  $("#pick-badge").innerHTML = suggestion.explored
    ? `<span class="pill blue">Exploring: random pick to learn something new</span>`
    : `<span class="pill cyan">Best of ${suggestion.considered} by MeTTa score</span>`;
  $("#sections").innerHTML = idea.structure
    .map((s) => `<span class="${HOOKS.includes(s.section) ? "hook" : ""}">${esc(s.section)} (${s.bars} bars)</span>`)
    .join("");
  $("#chords").innerHTML = idea.chords.map((c, i) => chordCard(c, i, idea)).join("");
  $("#theme-tag").textContent = `theme: ${idea.features.theme}`;
  $("#lyrics").innerHTML = idea.lyrics.map((line) => `<li>${esc(line)}</li>`).join("");
  $("#score-tag").textContent = `MeTTa score ${signed(suggestion.score)}`;
  $("#reasons").innerHTML = reasons.map(reasonRow).join("");
  $$(".verdict").forEach((b) => (b.disabled = false));
}

function chordCard(chord, i, idea) {
  const low = Math.min(...chord.midi);
  const range = Math.max(1, Math.max(...chord.midi) - low);
  const bars = chord.midi
    .map((m, j) => `<div><span>${esc(chord.notes[j])}</span><i style="width:${30 + (70 * (m - low)) / range}%"></i></div>`)
    .join("");
  return `
    <div class="chord">
      <div class="chord-top"><span class="eyebrow">Bar 0${i + 1} · ${esc(chord.function)}</span><span class="pill mono">${esc(chord.roman)}</span></div>
      <div class="chord-name">${esc(chord.name)}</div>
      <div class="voicing">${bars}</div>
      <div class="chord-foot"><span>${esc(idea.features.harmony)}</span><span>${esc(idea.features.rhythm)}</span></div>
    </div>`;
}

function reasonRow(r) {
  const mood = r.weight > 0 ? "up" : r.weight < 0 ? "down" : "";
  const why = r.shaped_by ? `Shaped by: ${esc(r.shaped_by)}` : "Not learned yet";
  return `<li><span>${esc(r.kind)}: <b>${esc(r.value)}</b></span><span class="w ${mood}">${signed(r.weight)} · ${esc(r.stance)}</span><small>${why}</small></li>`;
}

function renderRequests() {
  $("#request-chips").innerHTML = Object.entries(state.options.requests)
    .map(([id, label]) => `<button class="chip" data-change="${id}">+ ${esc(label)}</button>`)
    .join("");
}

function renderPreferences() {
  const options = state.options;
  const profile = state.ready ? state.profile : null;
  if (profile && !choice.genre) {
    Object.assign(choice, { genre: profile.genre, mood: profile.mood, bpm: profile.bpm });
    $("#pref-name").value = profile.name;
  }
  $("#genres").innerHTML = Object.entries(options.genres)
    .map(([id, label]) => `<button class="chip ${choice.genre === id ? "selected" : ""}" data-genre="${id}">${esc(label)}</button>`)
    .join("");
  $("#moods").innerHTML = Object.entries(options.moods)
    .map(([id, label]) => `<button class="chip ${choice.mood === id ? "selected" : ""}" data-mood="${id}">${esc(label)}</button>`)
    .join("");
  $("#tempo").value = choice.bpm;
  $("#tempo-value").textContent = choice.bpm;
  $("#tempo-band").textContent = band(choice.bpm);
  $("#seed").textContent = state.ready ? state.seed_text : "Save your preferences to generate the starting rules.";
  $("#calibrate-note").textContent = state.ready && state.version > 0
    ? "Saving again resets what the agent has learned so far."
    : "";
}

function timeAgo(iso) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function deltaChip(c) {
  const step = c.to - c.from;
  const stance = c.from_stance !== c.to_stance ? ` · ${c.from_stance} → ${c.to_stance}` : "";
  return `<span class="delta ${step > 0 ? "up" : "down"}">${signed(step)} ${esc(c.kind)} ${esc(c.value)}${stance}</span>`;
}

function entryCard(e) {
  const changes = e.changes || [];
  const parts = [
    `<div class="entry-head"><span class="kind ${e.kind}">${KIND_NAMES[e.kind]}</span><span class="mono muted">v${e.version} · ${timeAgo(e.time)} · ${e.count} rules</span></div>`,
    `<div>${esc(e.label)}</div>`,
    e.quote ? `<div class="quote">"${esc(e.quote)}"</div>` : "",
    e.before ? `<div class="ba"><span>Before</span>${esc(e.before)}</div>` : "",
    changes.length ? `<div class="arrow">↓ applied ${changes.length} rule change${changes.length > 1 ? "s" : ""}</div>` : "",
    e.after ? `<div class="ba after"><span>After: next idea</span>${esc(e.after)}</div>` : "",
    changes.length ? `<div class="deltas">${changes.map(deltaChip).join("")}</div>` : "",
  ];
  return `<div class="entry ${e.version === freshVersion ? "fresh" : ""}">${parts.join("")}</div>`;
}

function renderRules() {
  const value = state[rulesView];
  if (Array.isArray(value) && !value.length) {
    $("#rules").innerHTML = `<span class="muted">No changes since setup yet. Rate an idea to teach the agent.</span>`;
    return;
  }
  const lines = Array.isArray(value) ? value : value.split("\n");
  $("#rules").innerHTML = lines
    .map((l) => `<div class="${l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : ""}">${esc(l) || "&nbsp;"}</div>`)
    .join("");
}

function renderBadge() {
  const fresh = state?.ready ? state.version - seenVersion : 0;
  $("#engine-badge").hidden = fresh <= 0;
  $("#engine-badge").textContent = fresh;
}

function renderEngine() {
  if (!state.ready) {
    $("#history").innerHTML = `<div class="panel muted">Set your preferences to start the learning engine.</div>`;
    return;
  }
  const feedback = state.history.filter((h) => ["like", "dislike", "keep", "request"].includes(h.kind)).length;
  $("#stat-rules").textContent = `${state.seed_count} → ${state.rule_count}`;
  $("#stat-version").textContent = `v${state.version}`;
  $("#stat-feedback").textContent = feedback;
  $("#stat-kept").textContent = state.song.length;
  const peak = Math.max(...state.history.map((h) => h.count), 1);
  $("#growth").innerHTML = state.history
    .map((h) => `<i title="v${h.version}: ${h.count} rules" style="height:${12 + (88 * h.count) / peak}%"></i>`)
    .join("");
  $("#history").innerHTML = state.history.slice().reverse().map(entryCard).join("");
  renderRules();
  renderBadge();
}

function syncPeople() {
  if (!state.ready) return;
  const names = [state.profile.name, ...state.song.map((s) => s.who)];
  names.forEach((name) => {
    let person = people.find((p) => p.name === name);
    if (!person && !synced.has(name)) {
      person = { name, roles: [], notes: "", share: 0, agreed: false };
      people.push(person);
    }
    synced.add(name);
    const kept = state.song.filter((s) => s.who === name).length;
    if (!person || !kept) return;
    if (!person.roles.length) person.roles = ["music"];
    if (!person.notes || person.notes.startsWith("Chose and kept")) {
      person.notes = `Chose and kept ${kept} idea${kept > 1 ? "s" : ""} in NoteFlow`;
    }
  });
}

function personCard(p, i) {
  const roles = Object.entries(state.options.roles)
    .map(([role, points]) => `<label><input type="checkbox" data-i="${i}" data-role="${role}" ${p.roles.includes(role) ? "checked" : ""}> ${role} <span class="muted">${points}</span></label>`)
    .join("");
  return `
    <div class="person">
      <input data-i="${i}" data-field="name" value="${esc(p.name)}" placeholder="Collaborator name">
      <div class="roles">${roles}</div>
      <div class="share"><input type="number" min="0" max="100" data-i="${i}" data-field="share" value="${p.share}">%</div>
      <button class="small" data-remove="${i}">Remove</button>
      <input class="notes" data-i="${i}" data-field="notes" value="${esc(p.notes)}" placeholder="Contribution notes, e.g. wrote the chorus lyrics">
      <label class="agree"><input type="checkbox" data-i="${i}" data-field="agreed" ${p.agreed ? "checked" : ""}><span class="status ${p.agreed ? "agreed" : "proposed"}">${p.agreed ? "Agreed" : "Proposed"}</span></label>
    </div>`;
}

function renderPeople() {
  $("#people").innerHTML = people.length
    ? people.map(personCard).join("")
    : `<div class="panel muted">Add the people who worked on this song.</div>`;
  renderAllocation();
}

function renderAllocation() {
  const total = people.reduce((sum, p) => sum + (Number(p.share) || 0), 0);
  const allAgreed = people.length > 0 && people.every((p) => p.agreed);
  $("#alloc-total").textContent = `${total}% accounted`;
  $("#alloc-note").textContent = total === 100 ? "Ready" : total < 100 ? `${100 - total}% left to assign` : `${total - 100}% over`;
  $("#alloc-note").className = `mono small ${total === 100 ? "cyan" : ""}`;
  $("#alloc-bar").innerHTML = people
    .map((p, i) => `<i style="width:${Math.min(100, Number(p.share) || 0)}%;background:${COLORS[i % COLORS.length]}"></i>`)
    .join("");
  $("#alloc-legend").innerHTML = people
    .map((p, i) => `<span style="--c:${COLORS[i % COLORS.length]}">${esc(p.name || "Unnamed")} (${Number(p.share) || 0}%)</span>`)
    .join("");
  const ready = total === 100 && allAgreed;
  $("#sheet-status").textContent = ready ? "All agreed · ready to sign" : "Draft";
  $("#sheet-status").className = `pill mono ${ready ? "cyan" : ""}`;
}

function renderSongIdeas() {
  const song = state.ready ? state.song : [];
  $("#song-ideas").innerHTML = song.length
    ? song.map((s) => `
        <div class="song-idea">
          <b>${esc(s.summary)}</b>
          <div class="muted small">Kept by ${esc(s.who)} · ${esc(s.idea.structure.map((x) => x.section).join(" – "))}</div>
          <div class="small">${s.idea.lyrics.map(esc).join(" / ")}</div>
        </div>`).join("")
    : `<p class="muted">No ideas kept yet. Press "Keep for song" in the Studio.</p>`;
}

function renderSplit() {
  syncPeople();
  renderPeople();
  renderSongIdeas();
}

function renderAll() {
  renderHeader();
  renderSuggestion();
  if (state.ready) renderRequests();
  renderPreferences();
  renderEngine();
  renderSplit();
}

function summarize(changes) {
  if (!changes.length) return "No rule changes.";
  const top = changes.slice(0, 3).map((c) => `${c.kind} ${c.value} ${signed(c.from)}→${signed(c.to)}`);
  const more = changes.length > 3 ? ` and ${changes.length - 3} more` : "";
  return `${top.join(", ")}${more}.`;
}

function learned(result) {
  state = result.state;
  suggestion = result.suggestion;
  freshVersion = result.entry.version;
  renderAll();
  toast(`Learned: ${summarize(result.entry.changes)} New idea ready.`);
  play();
}

let busy = false;

async function guarded(task) {
  if (busy) return;
  busy = true;
  document.body.classList.add("busy");
  try {
    await task();
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy = false;
    document.body.classList.remove("busy");
  }
}

$$(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
$$(".go-preferences").forEach((b) => b.addEventListener("click", () => showTab("preferences")));
$("#play").addEventListener("click", play);
$("#stop").addEventListener("click", stopAudio);

$("#regenerate").addEventListener("click", () => guarded(async () => {
  suggestion = await api("/api/suggest", {});
  renderSuggestion();
  play();
}));

$$(".verdict").forEach((button) => button.addEventListener("click", () => guarded(async () => {
  const body = { id: suggestion.idea.id, verdict: button.dataset.verdict, who: $("#who").value };
  learned(await api("/api/feedback", body));
})));

$("#request-chips").addEventListener("click", (e) => {
  const change = e.target.closest("[data-change]")?.dataset.change;
  if (!change) return;
  guarded(async () => learned(await api("/api/request", { id: suggestion.idea.id, changes: [change], who: $("#who").value })));
});

$("#ask").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#ask-text").value.trim();
  if (!text) return;
  guarded(async () => {
    learned(await api("/api/request", { id: suggestion.idea.id, text, who: $("#who").value }));
    $("#ask-text").value = "";
  });
});

$("#genres").addEventListener("click", (e) => {
  if (!e.target.dataset.genre) return;
  choice.genre = e.target.dataset.genre;
  renderPreferences();
});

$("#moods").addEventListener("click", (e) => {
  if (!e.target.dataset.mood) return;
  choice.mood = e.target.dataset.mood;
  renderPreferences();
});

$("#tempo").addEventListener("input", (e) => {
  choice.bpm = Number(e.target.value);
  $("#tempo-value").textContent = choice.bpm;
  $("#tempo-band").textContent = band(choice.bpm);
});

$("#calibrate").addEventListener("click", () => guarded(async () => {
  if (!choice.genre || !choice.mood) throw new Error("Pick a genre and a mood first.");
  if (state.ready && state.version > 0 && !confirm("Recalibrating resets what the agent has learned. Continue?")) return;
  const name = $("#pref-name").value.trim() || "You";
  const result = await api("/api/setup", { name, genre: choice.genre, mood: choice.mood, bpm: choice.bpm });
  state = result.state;
  suggestion = result.suggestion;
  seenVersion = 0;
  $("#who").value = name;
  renderAll();
  showTab("studio");
  toast(`Calibrated: the agent starts with ${state.seed_count} MeTTa rules from your preferences.`);
}));

$("#reset").addEventListener("click", () => guarded(async () => {
  if (!confirm("Forget everything learned and go back to the rules from your preferences?")) return;
  const result = await api("/api/reset", {});
  state = result.state;
  suggestion = result.suggestion;
  seenVersion = 0;
  renderAll();
}));

$$(".seg button").forEach((b) => b.addEventListener("click", () => {
  rulesView = b.dataset.rules;
  $$(".seg button").forEach((x) => x.classList.toggle("active", x === b));
  renderRules();
}));

$("#people").addEventListener("input", (e) => {
  const { i, field } = e.target.dataset;
  if (!field || field === "agreed") return;
  people[i][field] = field === "share" ? Number(e.target.value) : e.target.value;
  renderAllocation();
});

$("#people").addEventListener("change", (e) => {
  const { i, role, field } = e.target.dataset;
  if (role) {
    const roles = people[i].roles;
    people[i].roles = e.target.checked ? [...roles, role] : roles.filter((r) => r !== role);
  }
  if (field === "agreed") {
    people[i].agreed = e.target.checked;
    renderPeople();
  }
});

$("#people").addEventListener("click", (e) => {
  if (e.target.dataset.remove === undefined) return;
  people.splice(Number(e.target.dataset.remove), 1);
  renderPeople();
});

$("#add-person").addEventListener("click", () => {
  people.push({ name: "", roles: [], notes: "", share: 0, agreed: false });
  renderPeople();
});

$("#propose").addEventListener("click", () => guarded(async () => {
  const { rows } = await api("/api/splits", { contributors: people });
  if (!rows.length) throw new Error("Give each collaborator a name and at least one role.");
  people.forEach((p) => {
    p.share = rows.find((r) => r.name === p.name.trim())?.percent ?? 0;
    p.agreed = false;
  });
  renderPeople();
  toast("Shares proposed from the MeTTa role rules. Edit them until everyone agrees.");
}));

function sheetData() {
  return {
    title: $("#song-title").value.trim() || "Untitled",
    date: $("#song-date").value,
    total: people.reduce((sum, p) => sum + (Number(p.share) || 0), 0),
    song: state?.ready ? state.song : [],
  };
}

$("#download").addEventListener("click", () => {
  const sheet = sheetData();
  const lines = [
    `# Split sheet (draft): ${sheet.title}`,
    "",
    `Date: ${sheet.date}`,
    `Total allocated: ${sheet.total}%`,
    "",
    "| Collaborator | Roles | Contribution | Share | Status |",
    "| --- | --- | --- | --- | --- |",
    ...people.map((p) => `| ${p.name} | ${p.roles.join(", ")} | ${p.notes} | ${Number(p.share) || 0}% | ${p.agreed ? "Agreed" : "Proposed"} |`),
    "",
    "## Work details",
    "",
    ...(sheet.song.length
      ? sheet.song.map((s) => `- ${s.summary} (kept by ${s.who})\n  - Structure: ${s.idea.structure.map((x) => x.section).join(" – ")}\n  - Lyrics: ${s.idea.lyrics.join(" / ")}`)
      : ["- No ideas kept in this session"]),
    "",
    "## AI disclosure",
    "",
    "NoteFlow suggested chords, song structures and lyric sketches using MeTTa rules. No royalty share is assigned to the AI.",
    "",
    "## Signatures",
    "",
    ...people.map((p) => `- ${p.name}: ______________________  Date: __________`),
    "",
    "_Draft generated by NoteFlow. Not legal advice. All collaborators must agree before it is final._",
  ];
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/markdown" }));
  link.download = `split-sheet-${sheet.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
  link.click();
});

$("#print").addEventListener("click", () => {
  const sheet = sheetData();
  const rows = people
    .map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.roles.join(", "))}</td><td>${esc(p.notes)}</td><td>${Number(p.share) || 0}%</td><td>${p.agreed ? "Agreed" : "Proposed"}</td></tr>`)
    .join("");
  const ideas = sheet.song.map((s) => `<li>${esc(s.summary)} (kept by ${esc(s.who)})</li>`).join("") || "<li>None</li>";
  const signs = people.map((p) => `<p>${esc(p.name)}: ______________________ Date: __________</p>`).join("");
  $("#print-area").innerHTML = `
    <h1>Split sheet (draft): ${esc(sheet.title)}</h1>
    <p>Date: ${esc(sheet.date)} · Total allocated: ${sheet.total}%</p>
    <table><tr><th>Collaborator</th><th>Roles</th><th>Contribution</th><th>Share</th><th>Status</th></tr>${rows}</table>
    <h3>Work details</h3><ul>${ideas}</ul>
    <h3>AI disclosure</h3><p>NoteFlow suggested chords, song structures and lyric sketches. No royalty share is assigned to the AI.</p>
    <h3>Signatures</h3>${signs}
    <p><em>Draft generated by NoteFlow. Not legal advice.</em></p>`;
  window.print();
});

$("#song-date").value = new Date().toISOString().slice(0, 10);

api("/api/state").then((data) => {
  state = data;
  if (state.ready) {
    seenVersion = state.version;
    return api("/api/suggest", {}).then((s) => (suggestion = s));
  }
}).then(() => {
  renderAll();
  if (!state.ready) showTab("preferences");
});
