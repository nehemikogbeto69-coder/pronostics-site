/**
 * Intégrité du projet — CTR Studio AI.
 *
 * Vérifications statiques qui évitent les mauvaises surprises au chargement :
 *  - chaque import relatif pointe vers un fichier qui existe ;
 *  - aucune dépendance externe (pas de CDN, pas d'API payante) ;
 *  - l'architecture en couches est respectée (core/features n'appellent pas l'UI) ;
 *  - index.html ne référence que des fichiers présents ;
 *  - les modules « navigateur uniquement » ne sont pas importés par le cœur.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Tous les fichiers source du projet (hors node_modules). */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, out);
    else if (/\.(mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

const SOURCES = walk(path.join(ROOT, "src"));
const TESTS = walk(path.join(ROOT, "tests"));
const TOOLS = walk(path.join(ROOT, "tools"));
const ALL = [...SOURCES, ...TESTS, ...TOOLS];

const SPECIFIER = /(?:^|\n)\s*(?:import|export)\s[\s\S]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^import\s*["']([^"']+)["']/gm;

/** Spécificateurs d'import d'un fichier. */
function specifiersOf(file) {
  const code = readFileSync(file, "utf8");
  const found = [];
  for (const match of code.matchAll(SPECIFIER)) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (spec) found.push(spec);
  }
  return found;
}

const rel = (file) => path.relative(ROOT, file);

describe("intégrité des modules", () => {
  test("le projet contient bien toute l'arborescence attendue", () => {
    const expected = [
      "src/main.js",
      "src/core/renderer.js",
      "src/core/composition.js",
      "src/core/textLayout.js",
      "src/core/templates.js",
      "src/io/exporter.js",
      "src/io/png.js",
      "src/io/imageImport.js",
      "src/io/storage.js",
      "src/features/analysis/report.js",
      "src/features/ideas/generator.js",
      "src/ui/store.js",
      "src/ui/stage.js",
      "src/ui/inspector.js",
      "src/ui/editorView.js",
      "src/ui/analysisView.js",
      "src/ui/ideasView.js",
      "src/ui/exportPanel.js",
      "tools/dev-server.mjs",
      "index.html",
    ];
    for (const file of expected) {
      assert.ok(existsSync(path.join(ROOT, file)), `${file} doit exister`);
    }
    assert.ok(SOURCES.length >= 20, `au moins 20 modules source (réel : ${SOURCES.length})`);
  });

  test("chaque import relatif correspond à un fichier présent", () => {
    const missing = [];
    for (const file of ALL) {
      for (const spec of specifiersOf(file)) {
        if (!spec.startsWith(".")) continue;
        const target = path.resolve(path.dirname(file), spec);
        if (!existsSync(target)) missing.push(`${rel(file)} → ${spec}`);
      }
    }
    assert.deepEqual(missing, [], `imports cassés :\n${missing.join("\n")}`);
  });

  test("aucune dépendance externe : pas de CDN, pas d'URL, pas d'API payante", () => {
    const external = [];
    for (const file of ALL) {
      for (const spec of specifiersOf(file)) {
        if (/^https?:\/\//.test(spec) || /^\/\//.test(spec)) external.push(`${rel(file)} → ${spec}`);
      }
    }
    assert.deepEqual(external, [], external.join("\n"));

    /* Aucun fetch/XHR vers un service tiers dans le code applicatif. */
    for (const file of SOURCES) {
      const code = readFileSync(file, "utf8");
      assert.ok(
        !/fetch\s*\(\s*["'`]https?:/.test(code),
        `${rel(file)} ne doit appeler aucun service distant`,
      );
      assert.ok(
        !/new XMLHttpRequest/.test(code),
        `${rel(file)} ne doit pas ouvrir de connexion réseau`,
      );
    }
  });

  test("les seuls modules tiers sont les outils de test Node", () => {
    const allowed = new Set(["jsdom", "@napi-rs/canvas", "node:test", "node:assert", "node:fs", "node:path", "node:url", "node:http"]);
    const bare = new Set();
    for (const file of ALL) {
      for (const spec of specifiersOf(file)) {
        if (spec.startsWith(".") || spec.startsWith("node:")) {
          if (spec.startsWith("node:")) bare.add(spec);
          continue;
        }
        bare.add(spec);
      }
    }
    for (const name of bare) {
      assert.ok(
        allowed.has(name) || name.startsWith("node:"),
        `dépendance non prévue : ${name} (aucune dépendance runtime n'est autorisée)`,
      );
    }
    /* Le code applicatif (src/) n'importe AUCUN paquet tiers. */
    for (const file of SOURCES) {
      for (const spec of specifiersOf(file)) {
        assert.ok(spec.startsWith("."), `${rel(file)} n'importe que des modules locaux (${spec})`);
      }
    }
  });

  test("le cœur et les fonctionnalités ignorent l'interface", () => {
    const core = [...SOURCES].filter((f) => /src\/(core|features|io)\//.test(f));
    for (const file of core) {
      for (const spec of specifiersOf(file)) {
        assert.ok(
          !spec.includes("/ui/"),
          `${rel(file)} ne doit pas dépendre de l'UI (${spec})`,
        );
      }
    }
  });

  test("les modules navigateur-only ne sont pas importés par le cœur", () => {
    /* imageImport et storage manipulent le DOM/localStorage : réservés à l'UI. */
    const browserOnly = ["imageImport.js", "storage.js"];
    const core = SOURCES.filter((f) => /src\/(core|features)\//.test(f));
    for (const file of core) {
      for (const spec of specifiersOf(file)) {
        for (const name of browserOnly) {
          assert.ok(!spec.endsWith(name), `${rel(file)} ne doit pas importer ${name}`);
        }
      }
    }
  });

  test("le cœur reste exécutable hors navigateur (rendu + export)", async () => {
    /* Preuve que renderer/exporter n'ont pas besoin du DOM : on les charge dans
       un Node pur, sans aucun global navigateur. */
    assert.equal(typeof globalThis.document, "undefined", "pas de document dans ce test");
    const { createComposition } = await import("../src/core/composition.js");
    const { drawComposition } = await import("../src/core/renderer.js");
    const { createCanvas } = await import("@napi-rs/canvas");
    const canvas = createCanvas(1280, 720);
    const report = drawComposition(canvas.getContext("2d"), createComposition(), { editable: false });
    assert.ok(Array.isArray(report.warnings));
    assert.equal(report.layers.length, 1);
  });
});

describe("intégrité de la page", () => {
  const html = readFileSync(path.join(ROOT, "index.html"), "utf8");

  test("toutes les ressources locales référencées existent", () => {
    const refs = [...html.matchAll(/(?:href|src)="(\.\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(refs.length >= 5, "la page référence ses feuilles de style et son module");
    for (const ref of refs) {
      assert.ok(existsSync(path.join(ROOT, ref)), `${ref} doit exister`);
    }
  });

  test("les identifiants requis par l'interface sont présents", () => {
    const required = [
      "thumb-canvas",
      "canvas-frame",
      "stage-status",
      "inspector",
      "panel-nav",
      "template-list",
      "panel-layers",
      "layers-actions",
      "panel-text",
      "panel-style",
      "panel-photo",
      "panel-bg",
      "photo-meta",
      "photo-actions",
      "export-fields",
      "btn-export",
      "export-result",
      "export-fallback",
      "project-actions",
      "autosave-status",
      "photo-input",
      "font-input",
      "project-import-input",
      "btn-photo",
      "btn-undo",
      "btn-redo",
      "btn-guides",
      "btn-reset",
      "btn-analyze-current",
      "btn-export-quick",
      "btn-about",
      "text-modal",
      "text-modal-input",
      "text-modal-quick",
      "text-modal-apply",
      "about-modal",
      "analysis-file",
      "analysis-dropzone",
      "analysis-overlay",
      "analysis-title",
      "analysis-topic",
      "analysis-run",
      "analysis-use-current",
      "analysis-source",
      "analysis-results",
      "analysis-empty",
      "analysis-title-preview",
      "ideas-topic",
      "ideas-audience",
      "ideas-tone",
      "ideas-run",
      "ideas-notice",
      "ideas-results",
      "ideas-empty",
      "ideas-meta",
      "view-editor",
      "view-analysis",
      "view-ideas",
      "toasts",
      "a11y-live",
    ];
    const missing = required.filter((id) => !html.includes(`id="${id}"`));
    assert.deepEqual(missing, [], `identifiants manquants : ${missing.join(", ")}`);
  });

  test("la page est en français et annonce ses limites", () => {
    assert.match(html, /<html lang="fr">/);
    assert.match(html, /ne prédit pas de taux de clic/i);
    assert.match(html, /100\s*%|100&nbsp;%\s*local/i);
  });

  test("les panneaux correspondent à la navigation déclarée dans l'UI", () => {
    for (const panel of ["calques", "texte", "style", "photo", "fond", "export"]) {
      assert.ok(html.includes(`data-panel="${panel}"`), `panneau ${panel} présent`);
    }
    for (const view of ["editor", "analysis", "ideas"]) {
      assert.ok(html.includes(`data-view="${view}"`), `onglet ${view} présent`);
    }
  });
});

describe("hygiène du dépôt", () => {
  test("node_modules et package-lock sont ignorés", () => {
    const ignorePath = path.join(ROOT, ".gitignore");
    if (!existsSync(ignorePath)) {
      const parent = path.join(ROOT, "..", ".gitignore");
      assert.ok(existsSync(parent), "un .gitignore doit exister");
      const content = readFileSync(parent, "utf8");
      assert.match(content, /node_modules/);
      return;
    }
    const content = readFileSync(ignorePath, "utf8");
    assert.match(content, /node_modules/);
    assert.match(content, /package-lock\.json/);
  });

  test("package.json expose les scripts de lancement et de test", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    assert.equal(pkg.type, "module");
    assert.ok(pkg.scripts.start, "script start");
    assert.ok(pkg.scripts.test, "script test");
    assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [], "aucune dépendance runtime");
  });
});
