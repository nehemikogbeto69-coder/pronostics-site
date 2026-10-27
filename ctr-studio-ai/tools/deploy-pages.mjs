#!/usr/bin/env node
/**
 * Prépare le dossier `docs/` servi par GitHub Pages.
 *
 *   node tools/deploy-pages.mjs
 *
 * GitHub Pages peut publier le contenu du dossier `/docs` À LA RACINE du
 * dépôt : ce script y copie l'application (index.html, src/, styles/) telle
 * quelle, sans build.
 * Ensuite : commit + push, et c'est en ligne sur
 * https://<utilisateur>.github.io/<depot>/
 *
 * L'application n'utilisant que des chemins relatifs, elle fonctionne à la
 * racine d'un domaine comme dans un sous-dossier.
 */

import { cpSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
/* `/docs` doit être à la racine du dépôt pour GitHub Pages. */
const OUT = path.resolve(ROOT, "..", "docs");

rmSync(OUT, { recursive: true, force: true });

cpSync(path.join(ROOT, "index.html"), path.join(OUT, "index.html"));
for (const dir of ["src", "styles"]) {
  cpSync(path.join(ROOT, dir), path.join(OUT, dir), { recursive: true });
}
/* Désactive Jekyll : ce sont des fichiers statiques, rien à transformer. */
writeFileSync(path.join(OUT, ".nojekyll"), "");

console.log("docs/ prêt : committez puis poussez — GitHub Pages sert ce dossier.");
