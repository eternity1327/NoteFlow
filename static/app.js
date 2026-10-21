const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const COLORS = ["#6c3bff", "#35a7ff", "#48f0e5", "#a98bff", "#ffb86b", "#ff6b81"];
const KIND_NAMES = {
  like: "You liked it",
  dislike: "Not for you",
  keep: "Kept for the song",
  request: "You asked for a change",
  setup: "Starting taste",
  restore: "Picked up where you left off",
};
const TAB_NAMES = { studio: "Create", preferences: "Your taste", engine: "What it learned", split: "Credits" };
const HOOKS = ["Chorus", "Drop"];
const GROUPS = [
  ["Mood", ["darker", "brighter"]],
  ["Speed", ["faster", "slower"]],
  ["Feel", ["softer", "more-energy", "groovier", "steadier"]],
  ["Chords", ["simpler", "richer"]],
  ["Song", ["shorter", "longer", "new-lyrics"]],
];
const PHRASES = {
  mood: (v) => `a ${v} mood`,
  progression: (v) => `${v} chord progressions`,
  harmony: (v) => ({ triads: "simple chords", sevenths: "7th chords", extended: "rich 9th chords" })[v],
  rhythm: (v) => ({ pad: "long held chords", syncopated: "syncopated rhythms", arpeggio: "arpeggios" })[v],
  tempo: (v) => `${v} tempos`,
  structure: (v) => ({ short: "short verse–chorus songs", classic: "classic songs with a bridge", "build-drop": "build-and-drop songs" })[v],
  theme: (v) => `lyrics about ${v}`,
};
const REASON = {
  loves: "You love",
  likes: "You like",
  neutral: "Something new to try:",
  dislikes: "You don't usually like",
  avoids: "You usually avoid",
};
const NOW = { loves: "Now loves", likes: "Now likes", dislikes: "Now dislikes", avoids: "Now avoids", neutral: "No longer has an opinion on" };

let state = null;
let suggestion = null;
let rulesView = "since_setup";
let seenVersion = 0;
let freshVersion = null;
const choice = { genre: null, mood: null, bpm: 90 };
const people = [];
const synced = new Set();
const audio = { ctx: null, nodes: [], timers: [] };
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const SHORTCUTS = { l: '[data-verdict="like"]', d: '[data-verdict="dislike"]', k: '[data-verdict="keep"]', u: "#undo", n: "#regenerate" };
const MAIN_CHANGES = ["darker", "brighter", "faster", "slower"];
const DEMO = { genre: "lofi", mood: "melancholic", bpm: 82 };

const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const band = (bpm) => (bpm < 90 ? "slow" : bpm < 115 ? "medium" : "fast");
const phrase = (kind, value) => PHRASES[kind]?.(value) || `${kind} ${value}`;
const positive = (stance) => stance === "likes" || stance === "loves";

function changeSentence(c) {
  const what = phrase(c.kind, c.value);
  if (c.from_stance !== c.to_stance) return `${NOW[c.to_stance]} ${what}`;
  const more = c.to > c.from;
  if (positive(c.to_stance)) return `Likes ${what} ${more ? "even more" : "a bit less"}`;
  return `Dislikes ${what} ${more ? "a bit less" : "even more"}`;
}

function changeItem(c, tag = "li") {
  const up = c.to > c.from ? "up" : "down";
  return `<${tag} class="learned ${up}"><span>${esc(changeSentence(c))}</span><small>${signed(c.from)} → ${signed(c.to)}</small></${tag}>`;
}

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
  $$(".tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === name);
    b.setAttribute("aria-selected", String(b.dataset.tab === name));
  });
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === name));
  $("#tab-name").textContent = TAB_NAMES[name];
  if (name === "engine" && state?.ready) {
    seenVersion = state.version;
    renderBadge();
  }
  window.scrollTo({ top: 0 });
}

function unlockAudio() {
  audio.ctx = audio.ctx || new AudioContext();
  if (audio.ctx.state === "suspended") audio.ctx.resume();
}

function setPlaying(on) {
  $("#play").classList.toggle("playing", on);
  $("#play").setAttribute("aria-label", on ? "Stop playback" : "Play this idea");
  $("#play").title = on ? "Stop (Space)" : "Play (Space)";
}

function stopAudio() {
  audio.nodes.forEach((n) => { try { n.stop(); } catch (e) {} });
  audio.timers.forEach(clearTimeout);
  audio.nodes = [];
  audio.timers = [];
  $$("#chords .chord").forEach((c) => c.classList.remove("on"));
  setPlaying(false);
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
  unlockAudio();
  const idea = suggestion.idea;
  const beat = 60 / idea.bpm;
  const cards = $$("#chords .chord");
  setPlaying(true);
  let time = audio.ctx.currentTime + 0.05;
  idea.chords.forEach((chord, i) => {
    strum(idea.features.rhythm, chord.midi, time, beat);
    tone(hz(chord.midi[0] - 12), time, beat * 4, "sine", 0.18);
    const delay = (time - audio.ctx.currentTime) * 1000;
    audio.timers.push(setTimeout(() => cards[i]?.classList.add("on"), delay));
    audio.timers.push(setTimeout(() => cards[i]?.classList.remove("on"), delay + beat * 4000));
    time += beat * 4;
  });
  audio.timers.push(setTimeout(stopAudio, (time - audio.ctx.currentTime) * 1000));
}

function renderHeader() {
  const label = state?.ready
    ? `${state.options.genres[state.profile.genre]} · ${state.options.moods[state.profile.mood]}`
    : "Not set up yet";
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
  $("#pick-note").textContent = suggestion.explored
    ? "Trying something new to learn your taste"
    : `Best match for your taste, out of ${suggestion.considered} ideas`;
  $("#pick-note").className = `pick-note ${suggestion.explored ? "explore" : ""}`;
  $("#idea-title").textContent = `${idea.key[0].toUpperCase()}${idea.key.slice(1)} · ${idea.bpm} BPM`;
  $("#idea-meta").textContent = `${state.options.genres[state.profile.genre]} · ${state.options.moods[idea.features.mood]} mood · ${phrase("harmony", idea.features.harmony)} · ${phrase("rhythm", idea.features.rhythm)}`;
  $("#chords").innerHTML = idea.chords
    .map((c) => `<div class="chord"><b>${esc(c.name)}</b><small>${esc(c.roman)} · ${esc(c.function)}</small></div>`)
    .join('<span class="chord-arrow">→</span>');
  $("#sections").innerHTML = idea.structure
    .map((x) => `<span class="${HOOKS.includes(x.section) ? "hook" : ""}">${esc(x.section)} · ${x.bars} bars</span>`)
    .join("");
  $("#theme-tag").textContent = `About ${idea.features.theme}`;
  $("#lyrics").innerHTML = idea.lyrics.map((line) => `<li>${esc(line)}</li>`).join("");
  $("#voicings").innerHTML = idea.chords.map(voicingCard).join("");
  $("#reasons").innerHTML = reasons.map(reasonRow).join("");
  $$(".verdict").forEach((b) => (b.disabled = false));
  $("#undo").disabled = !state.can_undo;
}

function voicingCard(chord) {
  const low = Math.min(...chord.midi);
  const range = Math.max(1, Math.max(...chord.midi) - low);
  const bars = chord.midi
    .map((m, j) => `<div><span>${esc(chord.notes[j])}</span><i style="width:${30 + (70 * (m - low)) / range}%"></i></div>`)
    .join("");
  return `<div class="voicing-card"><b>${esc(chord.name)}</b><div class="voicing">${bars}</div></div>`;
}

function reasonRow(r) {
  const mood = r.weight > 0 ? "up" : r.weight < 0 ? "down" : "";
  const source = r.shaped_by === "Your preferences" ? "From your starting taste" : r.shaped_by ? `Learned from: ${r.shaped_by}` : "Not rated yet";
  return `<li class="${mood}"><span>${esc(REASON[r.stance])} <b>${esc(phrase(r.kind, r.value))}</b></span><span class="w">${signed(r.weight)}</span><small>${esc(source)}</small></li>`;
}

function changeButtons(ids, labels) {
  return ids.filter((id) => labels[id]).map((id) => `<button class="chip" data-change="${id}">${esc(labels[id])}</button>`).join("");
}

function renderRequests() {
  const box = $("#request-groups");
  if (box.dataset.ready) return;
  const labels = state.options.requests;
  const used = new Set([...MAIN_CHANGES, ...GROUPS.flatMap(([, ids]) => ids)]);
  const groups = [...GROUPS, ["More", Object.keys(labels).filter((id) => !used.has(id))]]
    .map(([name, ids]) => [name, ids.filter((id) => !MAIN_CHANGES.includes(id))])
    .filter(([, ids]) => ids.some((id) => labels[id]));
  box.innerHTML = `
    <div class="group main">${changeButtons(MAIN_CHANGES, labels)}</div>
    <details class="more-changes">
      <summary>More options</summary>
      ${groups.map(([name, ids]) => `<div class="group"><span>${name}</span>${changeButtons(ids, labels)}</div>`).join("")}
    </details>`;
  box.dataset.ready = "1";
}

function renderPreferences() {
  const options = state.options;
  const profile = state.ready ? state.profile : null;
  if (profile && !choice.genre) {
    Object.assign(choice, { genre: profile.genre, mood: profile.mood, bpm: profile.bpm });
    $("#pref-name").value = profile.name;
  }
  $("#genres").innerHTML = Object.entries(options.genres)
    .map(([id, label]) => `<button class="chip ${choice.genre === id ? "selected" : ""}" aria-pressed="${choice.genre === id}" data-genre="${id}">${esc(label)}</button>`)
    .join("");
  $("#moods").innerHTML = Object.entries(options.moods)
    .map(([id, label]) => `<button class="chip ${choice.mood === id ? "selected" : ""}" aria-pressed="${choice.mood === id}" data-mood="${id}">${esc(label)}</button>`)
    .join("");
  $("#tempo").value = choice.bpm;
  $("#tempo-value").textContent = choice.bpm;
  $("#tempo-band").textContent = band(choice.bpm);
  $("#seed").textContent = state.ready ? state.seed_text : "Save your taste to create the starting rules.";
  $("#calibrate-note").textContent = state.ready && state.version > 0
    ? "Saving again starts over and forgets what NoteFlow has learned."
    : "";
}

function timeAgo(iso) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function entryCard(e) {
  const changes = e.changes || [];
  const parts = [
    `<div class="entry-head"><span class="kind ${e.kind}">${KIND_NAMES[e.kind]}</span><span class="muted small">Update ${e.version} · ${timeAgo(e.time)}</span></div>`,
    e.kind === "setup" ? `<div>${esc(e.label.replace("Calibrated from preferences: ", "Started from your taste: "))}</div>` : `<div>${esc(e.label)}</div>`,
    e.quote ? `<div class="quote">"${esc(e.quote)}"</div>` : "",
    changes.length ? `<ul class="learned-list">${changes.map((c) => changeItem(c)).join("")}</ul>` : "",
    e.before ? `<div class="ba-row"><div class="ba"><span>Before</span><b>${esc(e.before)}</b></div><div class="ba-arrow">→</div><div class="ba after"><span>Next idea</span><b>${esc(e.after || "")}</b></div></div>` : "",
  ];
  return `<div class="entry ${e.version === freshVersion ? "fresh" : ""}">${parts.join("")}</div>`;
}

function renderRules() {
  const value = state[rulesView];
  if (Array.isArray(value) && !value.length) {
    $("#rules").innerHTML = `<span class="muted">No changes yet. React to an idea to teach NoteFlow.</span>`;
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
    $("#history").innerHTML = `<div class="panel muted">Set your taste first, then react to a few ideas.</div>`;
    return;
  }
  const feedback = state.history.filter((h) => ["like", "dislike", "keep", "request"].includes(h.kind)).length;
  $("#stat-rules").textContent = `${state.seed_count} → ${state.rule_count}`;
  $("#stat-version").textContent = state.version;
  $("#stat-feedback").textContent = feedback;
  $("#stat-kept").textContent = state.song.length;
  const peak = Math.max(...state.history.map((h) => h.count), 1);
  $("#growth").innerHTML = state.history
    .map((h) => `<i title="Update ${h.version}: ${h.count} taste rules" style="height:${12 + (88 * h.count) / peak}%"></i>`)
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
      person = { name, roles: [], notes: "", share: "", agreed: false };
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
  const roles = state.options.roles
    .map((role) => `<label><input type="checkbox" data-i="${i}" data-role="${role}" ${p.roles.includes(role) ? "checked" : ""}> ${role}</label>`)
    .join("");
  return `
    <div class="person">
      <input data-i="${i}" data-field="name" value="${esc(p.name)}" placeholder="Collaborator name" aria-label="Collaborator ${i + 1} name">
      <div class="roles">${roles}</div>
      <div class="share"><input type="number" min="1" max="100" step="1" placeholder="0" data-i="${i}" data-field="share" value="${p.share}" aria-label="${esc(p.name || `Collaborator ${i + 1}`)} share in percent">%</div>
      <button class="small" data-remove="${i}">Remove</button>
      <input class="notes" data-i="${i}" data-field="notes" value="${esc(p.notes)}" placeholder="Contribution notes, e.g. wrote the chorus lyrics" aria-label="${esc(p.name || `Collaborator ${i + 1}`)} contribution notes">
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
  $("#sheet-status").textContent = ready ? "All agreed · ready to sign" : "Draft · not yet agreed";
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

function showChanged(entry) {
  const changes = entry.changes || [];
  const more = changes.length > 5 ? `<li class="learned muted">…and ${changes.length - 5} more in "What it learned"</li>` : "";
  $("#changed-label").textContent = entry.label;
  $("#changed-before").textContent = entry.before;
  $("#changed-after").textContent = entry.after;
  $("#changed-list").innerHTML = changes.slice(0, 5).map((c) => changeItem(c)).join("") + more;
  $("#changed").hidden = false;
}

function learned(result) {
  state = result.state;
  suggestion = result.suggestion;
  freshVersion = result.entry.version;
  renderAll();
  showChanged(result.entry);
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  const n = result.entry.changes.length;
  toast(`Got it. NoteFlow updated ${n} taste rule${n === 1 ? "" : "s"} and wrote a new idea.`);
  play();
}

function clearAgreements() {
  people.forEach((p) => (p.agreed = false));
  $$("[data-field=agreed]").forEach((box) => (box.checked = false));
  $$(".agree .status").forEach((label) => {
    label.textContent = "Proposed";
    label.className = "status proposed";
  });
  $("#check-result").hidden = true;
}

let busy = false;

async function guarded(task, label = "Writing a new idea…") {
  if (busy) return;
  unlockAudio();
  busy = true;
  $("#busy span").textContent = label;
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
$("#play").addEventListener("click", () => ($("#play").classList.contains("playing") ? stopAudio() : play()));

$("#regenerate").addEventListener("click", () => guarded(async () => {
  suggestion = await api("/api/suggest", {});
  $("#changed").hidden = true;
  renderSuggestion();
  play();
}));

$$(".verdict").forEach((button) => button.addEventListener("click", () => guarded(async () => {
  const body = { id: suggestion.idea.id, verdict: button.dataset.verdict, who: $("#who").value };
  learned(await api("/api/feedback", body));
})));

$("#request-groups").addEventListener("click", (e) => {
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

async function startSetup(taste) {
  Object.assign(choice, taste);
  const name = $("#pref-name").value.trim() || "You";
  const result = await api("/api/setup", { name, ...taste });
  state = result.state;
  suggestion = result.suggestion;
  seenVersion = 0;
  $("#who").value = name;
  $("#changed").hidden = true;
  renderAll();
  showTab("studio");
  play();
  toast(`All set. NoteFlow starts with ${state.seed_count} taste rules from your choices. React to what you hear!`);
}

$("#calibrate").addEventListener("click", () => guarded(async () => {
  if (!choice.genre || !choice.mood) throw new Error("Pick a genre and a mood first, or try the quick demo.");
  if (state.ready && state.version > 0 && !confirm("This starts over and forgets what NoteFlow has learned. Continue?")) return;
  await startSetup({ genre: choice.genre, mood: choice.mood, bpm: choice.bpm });
}, "Setting up your taste…"));

$$(".demo").forEach((button) => button.addEventListener("click", () => guarded(async () => {
  if (state.ready && state.version > 0 && !confirm("The demo starts over and forgets what NoteFlow has learned. Continue?")) return;
  await startSetup(DEMO);
}, "Setting up the demo…")));

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest("input, textarea, select, [contenteditable]")) return;
  if (!$("#studio").classList.contains("active") || $("#studio-body").hidden) return;
  const key = e.key.toLowerCase();
  if (key === " ") {
    if (e.target.closest("button, a, summary")) return;
    e.preventDefault();
    $("#play").click();
    return;
  }
  const button = SHORTCUTS[key] && $(SHORTCUTS[key]);
  if (button && !button.disabled) {
    e.preventDefault();
    button.click();
  }
});

$("#reset").addEventListener("click", () => guarded(async () => {
  if (!confirm("Forget everything NoteFlow learned and start again from your taste?")) return;
  const result = await api("/api/reset", {});
  state = result.state;
  suggestion = result.suggestion;
  seenVersion = 0;
  $("#changed").hidden = true;
  renderAll();
}, "Starting over…"));

$("#undo").addEventListener("click", () => guarded(async () => {
  const result = await api("/api/undo", {});
  state = result.state;
  suggestion = result.suggestion;
  $("#changed").hidden = true;
  renderAll();
  toast(`Undone. NoteFlow forgot "${result.undone}" and went back to the previous idea.`);
}, "Undoing…"));

$$(".seg button").forEach((b) => b.addEventListener("click", () => {
  rulesView = b.dataset.rules;
  $$(".seg button").forEach((x) => x.classList.toggle("active", x === b));
  renderRules();
}));

$("#people").addEventListener("input", (e) => {
  const { i, field } = e.target.dataset;
  if (!field || field === "agreed") return;
  people[i][field] = field === "share" && e.target.value !== "" ? Number(e.target.value) : e.target.value;
  if (field !== "notes") clearAgreements();
  renderAllocation();
});

$("#people").addEventListener("change", (e) => {
  const { i, role, field } = e.target.dataset;
  if (role) {
    const roles = people[i].roles;
    people[i].roles = e.target.checked ? [...roles, role] : roles.filter((r) => r !== role);
    clearAgreements();
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
  people.push({ name: "", roles: [], notes: "", share: "", agreed: false });
  renderPeople();
});

$("#check").addEventListener("click", () => guarded(async () => {
  const contributors = people.map((p) => ({ ...p, share: p.share === "" ? null : Number(p.share) }));
  const result = await api("/api/splits", { contributors });
  const box = $("#check-result");
  box.className = `check-result ${result.ok ? "ok" : "bad"}`;
  box.innerHTML = result.ok
    ? `<li>Looks good: shares add up to ${result.total}%, and everyone has a name, a role and a share.</li>`
    : result.problems.map((problem) => `<li>${esc(problem)}</li>`).join("");
  box.hidden = false;
}, "Checking the split…"));

function sheetData() {
  return {
    title: $("#song-title").value.trim() || "Untitled",
    date: $("#song-date").value,
    total: people.reduce((sum, p) => sum + (Number(p.share) || 0), 0),
    song: state?.ready ? state.song : [],
  };
}

function sheetStatus(sheet) {
  return sheet.total === 100 && people.length && people.every((p) => p.agreed)
    ? "agreed by all collaborators, awaiting signatures"
    : "DRAFT, not yet agreed";
}

$("#download").addEventListener("click", () => {
  const sheet = sheetData();
  const lines = [
    `# Split sheet (${sheetStatus(sheet)}): ${sheet.title}`,
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
    "_Generated by NoteFlow. Shares were entered by the collaborators. Not legal advice. Final only when everyone signs._",
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
    <h1>Split sheet (${sheetStatus(sheet)}): ${esc(sheet.title)}</h1>
    <p>Date: ${esc(sheet.date)} · Total allocated: ${sheet.total}%</p>
    <table><tr><th>Collaborator</th><th>Roles</th><th>Contribution</th><th>Share</th><th>Status</th></tr>${rows}</table>
    <h3>Work details</h3><ul>${ideas}</ul>
    <h3>AI disclosure</h3><p>NoteFlow suggested chords, song structures and lyric sketches. No royalty share is assigned to the AI.</p>
    <h3>Signatures</h3>${signs}
    <p><em>Generated by NoteFlow. Shares were entered by the collaborators. Not legal advice. Final only when everyone signs.</em></p>`;
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
