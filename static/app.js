/* PronoLab — logique d'affichage
   Aucune dépendance externe : JavaScript natif uniquement. */

"use strict";

const state = {
  sport: "football",
  league: "",
  days: 7,
  minConfidence: 0,
  source: "",
  sort: "date",
  meta: null,
};

const $ = (sel) => document.querySelector(sel);

/* ------------------------------------------------------------------ utils */
function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso.includes("Z") || iso.includes("+") ? iso : iso + "Z");
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
  return d.toLocaleString("fr-FR", {
    weekday: "short", day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

function pct(v, digits = 1) {
  if (v === null || v === undefined) return "—";
  return (v * 100).toFixed(digits) + " %";
}

function num(v, digits = 2) {
  if (v === null || v === undefined) return "—";
  return Number(v).toFixed(digits);
}

function confidenceColor(c) {
  if (c >= 60) return "#3fb950";
  if (c >= 40) return "#d29922";
  if (c >= 25) return "#e3863a";
  return "#f85149";
}

function confidenceLabel(c) {
  if (c >= 65) return "Élevée";
  if (c >= 45) return "Moyenne";
  if (c >= 28) return "Faible";
  return "Très faible";
}

function crest(team) {
  if (team.logo) {
    return `<span class="crest"><img src="${team.logo}" alt="" loading="lazy"></span>`;
  }
  const label = (team.short || team.name || "?").slice(0, 3).toUpperCase();
  return `<span class="crest">${label}</span>`;
}

function sourceBadge(src) {
  if (!src) return "";
  const kind = src.kind || "demo";
  const title = {
    manual: "Match saisi à la main. Statistiques fournies par vous.",
    demo: "Données de démonstration, générées — pas réelles.",
    api: "Match récupéré automatiquement depuis l'API.",
  }[kind] || "";
  return `<span class="src src-${kind}" title="${title}">${src.label || kind}</span>`;
}

/* ------------------------------------------------------------------ fetch */
async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

async function loadMeta() {
  state.meta = await api("/api/meta");
  $("#site-name").textContent = state.meta.site_name;
  $("#disclaimer").textContent = state.meta.disclaimer;
  $("#banner-demo").hidden = !state.meta.demo;

  // Bandeau « saison historique » : une saison passée n'a aucun match à venir.
  const hist = state.meta.season_is_historical && !state.meta.demo;
  $("#banner-season").hidden = !hist;
  if (hist) {
    $("#season-year").textContent = state.meta.season;
    $("#free-seasons").textContent = (state.meta.free_seasons || []).join(", ");
  }

  const select = $("#league-select");
  select.innerHTML = '<option value="">Toutes</option>';
  for (const lg of state.meta.leagues) {
    const opt = document.createElement("option");
    opt.value = lg.id;
    opt.textContent = `${lg.name} (${lg.country})`;
    select.appendChild(opt);
  }

  const last = state.meta.last_sync;
  const next = state.meta.next_sync
    ? new Date(state.meta.next_sync).toLocaleTimeString("fr-FR")
    : "—";
  $("#meta-line").textContent =
    `${state.meta.predictions_in_db} pronostics en base · ` +
    `dernière sync : ${last ? (last.finished_at || last.started_at) : "jamais"} · ` +
    `prochaine : ${next} · ` +
    `intervalle : ${state.meta.sync_interval_minutes} min · ` +
    `mode : ${state.meta.data_mode}`;
}

async function loadHealth() {
  const dot = $("#status-dot");
  const text = $("#status-text");
  try {
    const h = await api("/api/health");
    dot.className = "dot " + (h.status === "ok" ? "ok" : "bad");
    text.textContent = h.provider_message || h.status;
  } catch (err) {
    dot.className = "dot bad";
    text.textContent = "source injoignable";
  }
}

async function loadMatches() {
  const box = $("#matches");
  box.innerHTML = '<p class="empty">Chargement…</p>';

  const params = new URLSearchParams({
    sport: state.sport,
    days: state.days,
    limit: 200,
  });
  if (state.league) params.set("league", state.league);
  if (state.minConfidence > 0) params.set("min_confidence", state.minConfidence);
  if (state.source) params.set("source", state.source);

  try {
    const data = await api(`/api/matches?${params}`);
    renderMatches(data.matches || []);
  } catch (err) {
    box.innerHTML = `<p class="empty">Erreur de chargement : ${err.message}</p>`;
  }
}

/* --------------------------------------------------------------- rendu */
function sortMatches(list) {
  const arr = list.slice();
  if (state.sort === "confidence") {
    arr.sort((a, b) => (b.prediction.confidence || 0) - (a.prediction.confidence || 0));
  } else if (state.sort === "league") {
    arr.sort((a, b) =>
      (a.league.name || "").localeCompare(b.league.name || "") ||
      (a.kickoff_utc || "").localeCompare(b.kickoff_utc || ""));
  } else {
    arr.sort((a, b) => (a.kickoff_utc || "").localeCompare(b.kickoff_utc || ""));
  }
  return arr;
}

function renderMatches(list) {
  const box = $("#matches");
  const sorted = sortMatches(list);
  $("#match-count").textContent =
    `${sorted.length} match${sorted.length > 1 ? "s" : ""} · ${state.days} jour(s)`;

  if (sorted.length === 0) {
    box.innerHTML = `<p class="empty">
      Aucun match à venir avec ces filtres.<br>
      <span class="small">Élargissez la période, ou lancez une synchronisation.</span>
    </p>`;
    return;
  }
  box.innerHTML = "";
  for (const m of sorted) box.appendChild(matchCard(m));
}

function matchCard(m) {
  const el = document.createElement("article");
  el.className = "match";
  const p = m.prediction;
  const c = p.confidence ?? 0;

  const pickClass = p.pick === "1" ? "home" : (p.pick === "2" ? "away" : "draw");
  const pickText = m.sportGuess === "tennis"
    ? p.pick_label
    : (p.pick === "1" ? m.home.name : (p.pick === "2" ? m.away.name : "Match nul"));

  el.innerHTML = `
    <div class="match-head">
      <div class="team home">
        ${crest(m.home)}
        <div>
          <div class="team-name">${m.home.name}</div>
          <div class="team-sub">domicile${p.lambda_home != null ? ` · xG ${num(p.lambda_home)}` : ""}</div>
        </div>
      </div>

      <div class="match-center">
        <div class="match-time">${fmtDateTime(m.kickoff_utc)}</div>
        <div class="match-league">${m.league.name || m.round || ""}</div>
        ${sourceBadge(m.source)}
      </div>

      <div class="team away">
        ${crest(m.away)}
        <div>
          <div class="team-name">${m.away.name}</div>
          <div class="team-sub">${p.lambda_away != null ? `xG ${num(p.lambda_away)} · ` : ""}extérieur</div>
        </div>
      </div>

      <div class="pick-box">
        <span class="pick-tag ${pickClass}">${p.pick === "X" ? "NUL" : p.pick}</span>
        <div class="pick-sub">${pickText} · ${num(c, 1)} %</div>
      </div>
    </div>

    <div class="probbar">
      <div class="seg-home" style="width:${(p.p_home || 0) * 100}%">${p.p_home ? pct(p.p_home, 0) : ""}</div>
      <div class="seg-draw" style="width:${(p.p_draw || 0) * 100}%">${p.p_draw ? pct(p.p_draw, 0) : ""}</div>
      <div class="seg-away" style="width:${(p.p_away || 0) * 100}%">${p.p_away ? pct(p.p_away, 0) : ""}</div>
    </div>

    <div class="match-body"></div>
  `;

  el.querySelector(".match-head").addEventListener("click", () => {
    const body = el.querySelector(".match-body");
    const willOpen = !el.classList.contains("open");
    el.classList.toggle("open");
    if (willOpen && !body.dataset.loaded) {
      body.dataset.loaded = "1";
      renderBody(body, m);
    }
  });
  return el;
}

function renderBody(body, m) {
  const p = m.prediction;
  const d = m.detail || {};
  const c = p.confidence ?? 0;
  const parts = [];

  // --- colonne 1 : pronostic
  const rows = [
    ["Victoire domicile", pct(p.p_home)],
    ["Match nul", pct(p.p_draw)],
    ["Victoire extérieur", pct(p.p_away)],
  ];
  if (p.over_25 != null) rows.push([`Plus de ${2.5} buts`, pct(p.over_25)]);
  if (p.btts != null) rows.push(["Les deux marquent", pct(p.btts)]);
  if (p.top_score) rows.push(["Score le plus probable", `${p.top_score} (${pct(p.top_score_prob)})`]);

  parts.push(`
    <div class="block">
      <h4>Pronostic</h4>
      ${rows.map(([k, v]) => `<div class="stat-row"><span>${k}</span><span>${v}</span></div>`).join("")}
      <div style="margin-top:11px">
        <div class="stat-row"><span>Indice de confiance</span><span>${num(c, 1)} %</span></div>
        <div class="conf-meter"><div class="conf-fill" style="width:${c}%;background:${confidenceColor(c)}"></div></div>
        <div class="small muted" style="margin-top:4px">
          ${confidenceLabel(c)} — calculé sur l'écart entre les issues et l'entropie du modèle.
        </div>
      </div>
      <div class="small muted" style="margin-top:9px">
        Modèle : <code>${p.model || "—"}</code><br>
        Calculé le ${p.created_at ? p.created_at.slice(0, 16).replace("T", " ") : "—"} UTC
      </div>
    </div>
  `);

  // --- colonne 2 : forces et stats
  if (d.strength_home || d.strength_away) {
    const sh = d.strength_home || {}, sa = d.strength_away || {};
    parts.push(`
      <div class="block">
        <h4>Forces (1.00 = moyenne de la ligue)</h4>
        <div class="stat-row"><span></span><span>${m.home.name.slice(0, 12)}</span></div>
        <div class="stat-row"><span>Attaque</span><span>${num(sh.attack, 3)}</span></div>
        <div class="stat-row"><span>Défense</span><span>${num(sh.defence, 3)}</span></div>
        <div class="stat-row" style="margin-top:7px"><span></span><span>${m.away.name.slice(0, 12)}</span></div>
        <div class="stat-row"><span>Attaque</span><span>${num(sa.attack, 3)}</span></div>
        <div class="stat-row"><span>Défense</span><span>${num(sa.defence, 3)}</span></div>
        ${d.baseline ? `
        <div class="small muted" style="margin-top:9px">
          Moyennes de la ligue : ${num(d.baseline.home_avg_goals)} buts à domicile,
          ${num(d.baseline.away_avg_goals)} à l'extérieur,
          avantage terrain ×${num(d.baseline.home_advantage)}.
        </div>` : ""}
      </div>
    `);
  }

  // --- colonne 3 : forme
  const formBlock = (label, f) => {
    if (!f) return "";
    const pills = (f.form || "").split("").map((r) => {
      const cls = "WV".includes(r) ? "W" : ("D".includes(r) ? "D" : "L");
      return `<span class="pill ${cls}">${r}</span>`;
    }).join("");
    return `
      <div style="margin-bottom:11px">
        <div class="small" style="margin-bottom:4px">${label}</div>
        <div class="form-pills">${pills || '<span class="muted small">pas de données</span>'}</div>
        <div class="small muted" style="margin-top:5px">
          ${num(f.points, 0)} pts sur ${ (f.form || "").length } matchs ·
          ${num(f.gf_avg)} marqués / ${num(f.ga_avg)} encaissés en moyenne
        </div>
      </div>
    `;
  };
  if (d.form_home || d.form_away) {
    parts.push(`
      <div class="block">
        <h4>Forme récente</h4>
        ${formBlock(m.home.name, d.form_home)}
        ${formBlock(m.away.name, d.form_away)}
      </div>
    `);
  }

  // --- colonne 4 : confrontations directes
  if (d.h2h && d.h2h.played) {
    const h = d.h2h;
    const lastRows = (h.last || []).slice(0, 5).map((g) => `
      <div class="stat-row">
        <span class="small">${g.date} — ${g.home.slice(0, 14)}</span>
        <span>${g.score}</span>
      </div>`).join("");
    parts.push(`
      <div class="block">
        <h4>Confrontations directes</h4>
        <div class="stat-row"><span>Rencontres</span><span>${h.played}</span></div>
        <div class="stat-row"><span>Victoires ${m.home.name.slice(0, 10)}</span><span>${h.home_wins}</span></div>
        <div class="stat-row"><span>Nuls</span><span>${h.draws}</span></div>
        <div class="stat-row"><span>Victoires ${m.away.name.slice(0, 10)}</span><span>${h.away_wins}</span></div>
        <div class="stat-row"><span>Buts par match</span><span>${num(h.total_goals)}</span></div>
        <div style="margin-top:8px">${lastRows}</div>
      </div>
    `);
  }

  // --- colonne 5 : matrice des scores
  if (m.matrix && m.matrix.length) {
    parts.push(`
      <div class="block">
        <h4>Probabilité de chaque score</h4>
        ${matrixTable(m.matrix, p.top_score)}
      </div>
    `);
  }

  // --- blessés
  const inj = d.injuries || [];
  if (inj.length) {
    const rows = inj.map((i) => `
      <div class="stat-row">
        <span>${i.player}${i.is_key ? " ★" : ""}</span>
        <span class="small">${i.reason}</span>
      </div>`).join("");
    parts.unshift(`
      <div class="block">
        <h4>Absents signalés</h4>
        <div class="alert">
          ${inj.length} joueur(s) absent(s). Le modèle actuel n'ajuste pas encore
          les forces en fonction : à prendre en compte vous-même.
        </div>
        ${rows}
      </div>
    `);
  }

  body.innerHTML = parts.join("");
}

function matrixTable(matrix, topScore) {
  const [ti, tj] = (topScore || "").split("-").map(Number);
  let html = '<table class="matrix"><tr><th></th>';
  for (let j = 0; j < matrix[0].length; j++) html += `<th>${j}</th>`;
  html += "</tr>";
  for (let i = 0; i < matrix.length; i++) {
    html += `<tr><th>${i}</th>`;
    for (let j = 0; j < matrix[i].length; j++) {
      const v = matrix[i][j];
      // Dégradé : plus la probabilité est haute, plus la cellule est verte.
      const alpha = Math.min(v / 0.14, 1);
      const isTop = i === ti && j === tj;
      html += `<td class="${isTop ? "top" : ""}" style="background:rgba(63,185,80,${(alpha * 0.55).toFixed(3)})">
        ${(v * 100).toFixed(v < 0.01 ? 1 : 0)}
      </td>`;
    }
    html += "</tr>";
  }
  html += `<caption>Lignes : buts à domicile · colonnes : buts à l'extérieur · valeurs en %</caption></table>`;
  return html;
}

/* ------------------------------------------------- résultats connus */
async function loadResults() {
  const box = $("#results");
  if (state.sport !== "football") {
    $("#results-section").hidden = true;
    return;
  }
  $("#results-section").hidden = false;
  box.innerHTML = '<p class="empty small">Chargement…</p>';

  const leagueId = state.league || (state.meta?.leagues?.[0]?.id ?? 39);
  try {
    const d = await api(`/api/results?league_id=${leagueId}&last_n=25`);
    $("#results-count").textContent =
      d.count ? `${d.count} matchs · ${d.season ? "saison " + d.season : ""}` : "";

    if (!d.count) {
      box.innerHTML = `<p class="empty small">
        Aucun match joué disponible pour cette ligue.
        <br><span class="small">Lancez une synchronisation, ou vérifiez la saison configurée.</span>
      </p>`;
      return;
    }

    const rows = d.matches.map((m) => {
      const pickName = m.pick === "1" ? m.home : (m.pick === "2" ? m.away : "Nul");
      const cls = m.hit ? "hit" : "miss";
      return `
        <tr>
          <td class="num small">${m.date}</td>
          <td>${m.home} <span class="muted">–</span> ${m.away}</td>
          <td class="num"><strong>${m.score}</strong></td>
          <td class="num">${num(m.lambda_home)}–${num(m.lambda_away)}</td>
          <td class="num">${pct(m.p_home, 0)} / ${pct(m.p_draw, 0)} / ${pct(m.p_away, 0)}</td>
          <td class="${cls}">${m.pick === "X" ? "Nul" : pickName}</td>
          <td class="num">${num(m.confidence, 0)} %</td>
          <td class="num">${m.score_hit ? "✓" : m.top_score}</td>
        </tr>`;
    }).join("");

    const acc = d.accuracy != null ? (d.accuracy * 100).toFixed(1) + " %" : "—";
    const base = d.baseline_accuracy != null ? (d.baseline_accuracy * 100).toFixed(1) + " %" : "—";

    box.innerHTML = `
      <div class="metric-grid">
        <div class="metric ${d.accuracy >= 0.5 ? "good" : ""}">
          <div class="v">${acc}</div><div class="k">Pronostics justes</div>
        </div>
        <div class="metric"><div class="v">${base}</div><div class="k">Référence « domicile »</div></div>
      </div>
      <table class="data">
        <thead><tr>
          <th>Date</th><th>Match</th><th>Score</th><th>xG</th>
          <th>1 / X / 2</th><th>Pronostic</th><th>Conf.</th><th>Score visé</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (err) {
    box.innerHTML = `<p class="empty small">Erreur : ${err.message}</p>`;
  }
}

/* ------------------------------------------------------- classement */
async function loadStandings() {
  const box = $("#standings");
  const leagueId = state.league || (state.meta?.leagues?.[0]?.id ?? 39);
  box.innerHTML = '<p class="empty small">Chargement…</p>';
  try {
    const data = await api(`/api/standings/${leagueId}`);
    if (!data.teams.length) {
      box.innerHTML = '<p class="empty small">Aucune donnée pour cette ligue.</p>';
      return;
    }
    const rows = data.teams.map((t) => `
      <tr>
        <td class="num">${t.position}</td>
        <td>${t.name}</td>
        <td class="num">${t.played}</td>
        <td class="num">${t.points}</td>
        <td class="num">${t.goal_diff > 0 ? "+" : ""}${t.goal_diff}</td>
        <td class="num">${num(t.attack_strength, 2)}</td>
        <td class="num">${num(t.defence_strength, 2)}</td>
      </tr>`).join("");
    box.innerHTML = `
      <div class="small muted" style="margin-bottom:8px">${data.league.name || ""}</div>
      <table class="data">
        <thead><tr>
          <th>#</th><th>Équipe</th><th>J</th><th>Pts</th><th>Diff.</th><th>Att.</th><th>Déf.</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (err) {
    box.innerHTML = `<p class="empty small">Erreur : ${err.message}</p>`;
  }
}

/* --------------------------------------------------------- backtest */
async function loadBacktest() {
  const box = $("#backtest");
  box.innerHTML = '<p class="empty small">Chargement…</p>';
  if (state.sport !== "football") {
    box.innerHTML = '<p class="empty small">Backtest disponible pour le football.</p>';
    return;
  }
  const leagueId = state.league || (state.meta?.leagues?.[0]?.id ?? 39);
  try {
    const b = await api(`/api/backtest?league_id=${leagueId}&last_n=100`);
    if (!b.matches) {
      box.innerHTML = '<p class="empty small">Pas assez de matchs joués pour évaluer le modèle.</p>';
      return;
    }
    const edgeGood = b.edge_vs_baseline_pct > 0;
    const calRows = (b.calibration || []).map((r) => `
      <tr>
        <td>${r.band}</td>
        <td class="num">${r.matches}</td>
        <td class="num bar-cell">
          <div class="bar-fill" style="width:${(r.hit_rate * 100).toFixed(0)}%"></div>
          <span>${(r.hit_rate * 100).toFixed(0)} %</span>
        </td>
      </tr>`).join("");

    box.innerHTML = `
      <div class="metric-grid">
        <div class="metric ${b.accuracy >= 0.5 ? "good" : ""}">
          <div class="v">${(b.accuracy * 100).toFixed(1)} %</div><div class="k">Réussite 1X2</div>
        </div>
        <div class="metric ${edgeGood ? "good" : "bad"}">
          <div class="v">${b.edge_vs_baseline_pct > 0 ? "+" : ""}${b.edge_vs_baseline_pct}</div>
          <div class="k">pts vs « toujours domicile »</div>
        </div>
        <div class="metric"><div class="v">${b.log_loss.toFixed(3)}</div><div class="k">Log-loss</div></div>
        <div class="metric"><div class="v">${b.brier.toFixed(3)}</div><div class="k">Brier</div></div>
      </div>
      <p class="small muted">
        ${b.matches} matchs évalués. Un taux de réussite de 50 % sur du 1X2 est déjà
        correct : le match nul rend l'exercice difficile, et la référence « jouer
        systématiquement domicile » tourne autour de ${(b.baseline_accuracy * 100).toFixed(0)} %.
      </p>
      <table class="data" style="margin-top:12px">
        <thead><tr><th>Confiance annoncée</th><th>Matchs</th><th>Réussite réelle</th></tr></thead>
        <tbody>${calRows}</tbody>
      </table>
      <p class="small muted" style="margin-top:10px">
        <strong>Calibration :</strong> si la colonne de droite suit les tranches de gauche,
        les probabilités du modèle sont honnêtes. ${
          b.roi ? `<br><br>Simulation de mise : ${b.roi.bets} paris, ROI ${b.roi.roi_pct} %.
          <em>${b.roi.note}</em>` : ""
        }
      </p>`;
  } catch (err) {
    box.innerHTML = `<p class="empty small">Erreur : ${err.message}</p>`;
  }
}

/* --------------------------------------------------------- évènements */
function bind() {
  document.querySelectorAll("#sport-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#sport-tabs .tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      state.sport = tab.dataset.sport;
      $("#league-select").disabled = state.sport !== "football";
      loadMatches();
      loadResults();
      loadBacktest();
    });
  });

  $("#league-select").addEventListener("change", (e) => {
    state.league = e.target.value;
    loadMatches();
    if (state.sport === "football") { loadResults(); loadStandings(); loadBacktest(); }
  });

  $("#days-select").addEventListener("change", (e) => {
    state.days = Number(e.target.value);
    loadMatches();
  });

  $("#confidence-range").addEventListener("input", (e) => {
    state.minConfidence = Number(e.target.value);
    $("#confidence-value").textContent = state.minConfidence + " %";
    loadMatches();
  });

  $("#source-select").addEventListener("change", (e) => {
    state.source = e.target.value;
    loadMatches();
  });

  $("#sort-select").addEventListener("change", async (e) => {
    state.sort = e.target.value;
    await loadMatches();
  });

  $("#btn-sync").addEventListener("click", async () => {
    const btn = $("#btn-sync");
    btn.disabled = true;
    btn.textContent = "Synchronisation…";
    try {
      await api("/api/sync", { method: "POST" });
      await Promise.all([loadMeta(), loadMatches(), loadResults(), loadStandings(), loadBacktest(), loadHealth()]);
    } catch (err) {
      alert("Échec de la synchronisation : " + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/>
        <path d="M21 3v6h-6"/></svg> Synchroniser`;
    }
  });
}

/* --------------------------------------------------- saisie manuelle */
function openModal() {
  const backdrop = $("#modal-backdrop");
  const err = $("#form-error");
  err.hidden = true;
  err.textContent = "";

  // Aligne le sélecteur de compétition sur le filtre courant.
  const leagueSelect = $("#form-league");
  if (state.league) leagueSelect.value = state.league;

  // Date par défaut : samedi prochain à 15h, pour éviter une saisie dans le passé.
  const kickoff = document.querySelector('#manual-form [name="kickoff_utc"]');
  if (!kickoff.value) {
    const d = new Date();
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
    d.setHours(15, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    kickoff.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T15:00`;
  }

  backdrop.hidden = false;
  document.body.style.overflow = "hidden";
  document.querySelector('#manual-form [name="home_name"]').focus();
}

function closeModal() {
  $("#modal-backdrop").hidden = true;
  document.body.style.overflow = "";
}

function fillLeagueSelect() {
  const select = $("#form-league");
  if (!select || select.options.length) return;
  for (const lg of state.meta?.leagues || []) {
    const opt = document.createElement("option");
    opt.value = lg.id;
    opt.textContent = `${lg.name} (${lg.country})`;
    select.appendChild(opt);
  }
}

function bindManualForm() {
  $("#btn-add-match").addEventListener("click", () => {
    fillLeagueSelect();
    openModal();
  });
  $("#modal-close").addEventListener("click", closeModal);
  $("#modal-cancel").addEventListener("click", closeModal);
  $("#modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#modal-backdrop").hidden) closeModal();
  });

  // Les légendes reprennent les noms saisis : on sait de quelle équipe on parle.
  const form = $("#manual-form");
  form.addEventListener("input", () => {
    const home = form.home_name.value.trim();
    const away = form.away_name.value.trim();
    $("#stats-home-name").textContent = home || "équipe à domicile";
    $("#stats-away-name").textContent = away || "équipe à l'extérieur";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#form-error");
    const submit = $("#form-submit");
    err.hidden = true;

    const payload = {};
    for (const el of form.elements) {
      if (el.name) payload[el.name] = el.value;
    }

    submit.disabled = true;
    submit.textContent = "Calcul…";
    try {
      const res = await fetch("/api/manual-matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Le serveur renvoie un message compréhensible : on l'affiche tel quel.
        throw new Error(body.detail || `Erreur ${res.status}`);
      }
      closeModal();
      form.reset();
      // Le match saisi doit être visible : on retire tout filtre qui le masquerait.
      state.source = "";
      $("#source-select").value = "";

      // On élargit la période si le match tombe au-delà de la fenêtre courante.
      const kickoff = body.match?.kickoff_utc;
      const daysUntil = kickoff
        ? Math.ceil((new Date(kickoff).getTime() - Date.now()) / 86400000)
        : 0;
      if (daysUntil > state.days) {
        state.days = Math.min(90, Math.max(14, daysUntil + 1));
        $("#days-select").value = String(state.days);
      }
      await loadMatches();

      // Un match saisi au-delà de 30 jours reste invisible : il faut le dire,
      // sinon l'utilisateur croira que la saisie a échoué.
      if (daysUntil > 90) {
        alert(
          "Match enregistré et pronostic calculé.\n\n" +
          "Il tombe dans " + daysUntil + " jours, au-delà de la fenêtre " +
          "d'affichage (90 jours maximum). Il apparaîtra dans la liste quand " +
          "il s'en rapprochera."
        );
      }
    } catch (exc) {
      err.textContent = exc.message;
      err.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = "Calculer le pronostic";
    }
  });
}

/* ------------------------------------------------------------- démarrage */
(async function init() {
  bind();
  bindManualForm();
  try {
    await loadMeta();
    await Promise.all([loadMatches(), loadResults(), loadStandings(), loadBacktest(), loadHealth()]);
  } catch (err) {
    $("#matches").innerHTML = `<p class="empty">Démarrage impossible : ${err.message}</p>`;
  }
})();
